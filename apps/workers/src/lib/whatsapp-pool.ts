import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Boom } from '@hapi/boom'
import { pino } from 'pino'
import { Redis } from 'ioredis'
import qrcode from 'qrcode-terminal'
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys'
import { env, isWhatsappInboundLogEnabled } from '@leadiya/config'
import { db, outreachLog, contacts, leads, eq, sql, and, gte } from '@leadiya/db'

const BASE_AUTH_DIR =
  env.WHATSAPP_BAILEYS_AUTH_DIR?.trim() || resolve(process.cwd(), 'data/baileys-auth')

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })

export { redis as waRedis }

interface TenantConnection {
  tenantId: string
  sock: WASocket | null
  isOpen: boolean
  authDir: string
  lastActivity: number
  connecting: boolean
}

const pool = new Map<string, TenantConnection>()

const IDLE_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
const MAX_CONNECTIONS = 50

/** Skip accidental double-queue (same text to same JID shortly apart). */
const OUTBOUND_DEDUPE_WINDOW_MS = 10 * 60 * 1000

function statusKey(tenantId: string) { return `wa:status:${tenantId}` }
function qrKey(tenantId: string) { return `wa:qr:${tenantId}` }

/** Redis TTL: "connected" must survive page reloads (was EX 300 → key vanished after 5 min while socket stayed open). */
function statusTtlSec(status: 'disconnected' | 'waiting_qr' | 'connected'): number {
  if (status === 'connected') return 604800 // 7d — refreshed on activity; Baileys session is on disk
  if (status === 'waiting_qr') return 300
  return 3600 // disconnected — show for a while, then expire to unknown if worker stopped
}

async function publishStatus(tenantId: string, status: 'disconnected' | 'waiting_qr' | 'connected'): Promise<void> {
  const ttl = statusTtlSec(status)
  await redis.set(statusKey(tenantId), JSON.stringify({ status, updatedAt: Date.now() }), 'EX', ttl)
  if (status !== 'waiting_qr') await redis.del(qrKey(tenantId))
}

async function publishQr(tenantId: string, qr: string): Promise<void> {
  await redis.set(qrKey(tenantId), qr, 'EX', 45)
  await publishStatus(tenantId, 'waiting_qr')
}

export async function getStatus(tenantId: string): Promise<{ status: string; qr?: string }> {
  const [raw, qr] = await Promise.all([
    redis.get(statusKey(tenantId)),
    redis.get(qrKey(tenantId)),
  ])
  if (!raw) return { status: 'disconnected' }
  try {
    const parsed = JSON.parse(raw) as { status: string }
    return { status: parsed.status, ...(qr ? { qr } : {}) }
  } catch {
    return { status: 'disconnected' }
  }
}

function textFromUpsertMessage(m: unknown): string {
  const raw = m as { message?: Record<string, unknown> | null }
  const msg = raw.message
  if (!msg) return ''
  if (typeof msg.conversation === 'string') return msg.conversation
  const ext = msg.extendedTextMessage as { text?: string } | undefined
  if (ext?.text) return ext.text
  const img = msg.imageMessage as { caption?: string } | undefined
  if (img) return img.caption?.trim() ? img.caption : '[Image]'
  const vid = msg.videoMessage as { caption?: string } | undefined
  if (vid) return vid.caption?.trim() ? vid.caption : '[Video]'
  const doc = msg.documentMessage as { caption?: string } | undefined
  if (doc) return doc.caption?.trim() ? doc.caption : '[Document]'
  if (msg.audioMessage) return '[Audio]'
  if (msg.stickerMessage) return '[Sticker]'
  return ''
}

/**
 * Inbound chats often arrive with `remoteJid` = …@lid (opaque id). Baileys may set `remoteJidAlt` to the
 * phone JID (…@s.whatsapp.net). Without this, findLeadByJid and outreach_log never line up with outbounds.
 */
function resolveInboundPeerJid(m: { key?: { remoteJid?: string | null; remoteJidAlt?: string | null } | null }): string {
  const k = m.key
  if (!k?.remoteJid) return ''
  if (k.remoteJid.endsWith('@lid') && k.remoteJidAlt?.endsWith('@s.whatsapp.net')) {
    return k.remoteJidAlt
  }
  return k.remoteJid
}

async function findLeadByJid(jid: string): Promise<string | null> {
  const digits = jid.replace(/@.*$/, '')
  if (!digits || digits.length < 10) return null
  try {
    const suffix = digits.length >= 10 ? digits.slice(-10) : null
    if (suffix) {
      const [fromDigits] = await db
        .select({ leadId: outreachLog.leadId })
        .from(outreachLog)
        .where(
          and(
            sql`${outreachLog.leadId} IS NOT NULL`,
            sql`right(regexp_replace(coalesce(${outreachLog.waPeer}::text, ''), '[^0-9]', '', 'g'), 10) = ${suffix}`,
          ),
        )
        .limit(1)
      if (fromDigits?.leadId) return fromDigits.leadId
    }

    const [fromLog] = await db
      .select({ leadId: outreachLog.leadId })
      .from(outreachLog)
      .where(sql`${outreachLog.waPeer} = ${jid} AND ${outreachLog.leadId} IS NOT NULL`)
      .limit(1)
    if (fromLog?.leadId) return fromLog.leadId

    const phoneVariants = [digits, `+${digits}`]
    if (digits.length === 11 && digits.startsWith('7')) {
      phoneVariants.push(`8${digits.slice(1)}`, `+7${digits.slice(1)}`)
    }
    for (const phone of phoneVariants) {
      const [contact] = await db
        .select({ leadId: contacts.leadId })
        .from(contacts)
        .where(eq(contacts.phone, phone))
        .limit(1)
      if (contact?.leadId) return contact.leadId
    }
    const [waLead] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(sql`${leads.whatsapp} LIKE ${'%' + digits + '%'}`)
      .limit(1)
    if (waLead?.id) return waLead.id
  } catch (e) {
    console.warn('[wa-pool] lead matching failed:', e instanceof Error ? e.message : e)
  }
  return null
}

let handleInboundReplyFn: ((leadId: string | null, jid: string, text: string) => Promise<void>) | null = null

export function setInboundHandler(fn: (leadId: string | null, jid: string, text: string) => Promise<void>) {
  handleInboundReplyFn = fn
}

async function connectTenant(tenantId: string): Promise<TenantConnection> {
  const existing = pool.get(tenantId)
  if (existing?.isOpen && existing.sock) {
    existing.lastActivity = Date.now()
    return existing
  }
  if (existing?.connecting) {
    const spinDeadline = Date.now() + 30_000
    while (existing.connecting) {
      if (Date.now() > spinDeadline) {
        throw new Error(`[wa-pool] Timed out waiting for tenant ${tenantId.slice(0, 8)} to finish connecting`)
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    if (existing.isOpen && existing.sock) return existing
  }

  if (pool.size >= MAX_CONNECTIONS) {
    evictIdlest()
  }

  const authDir = resolve(BASE_AUTH_DIR, tenantId)
  mkdirSync(authDir, { recursive: true })

  const conn: TenantConnection = {
    tenantId,
    sock: null,
    isOpen: false,
    authDir,
    lastActivity: Date.now(),
    connecting: true,
  }
  pool.set(tenantId, conn)

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    const s = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      syncFullHistory: false,
      markOnlineOnConnect: true,
      browser: ['Leadiya', 'Desktop', '1.0.0'],
    })
    conn.sock = s

    s.ev.on('creds.update', saveCreds)
    s.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update
      if (qr) {
        console.log(`[wa-pool] QR for tenant ${tenantId.slice(0, 8)}`)
        qrcode.generate(qr, { small: true })
        void publishQr(tenantId, qr)
      }
      if (connection === 'close') {
        conn.isOpen = false
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut
        const isReplaced = statusCode === DisconnectReason.connectionReplaced
        /** 440 = another device/session took this connection — avoid tight 4s reconnect loop. */
        const reconnectMs = isReplaced ? 90_000 : 4_000
        console.warn(`[wa-pool] ${tenantId.slice(0, 8)} disconnected`, lastDisconnect?.error?.message, statusCode)
        if (isReplaced) {
          console.warn(
            `[wa-pool] ${tenantId.slice(0, 8)} connection replaced — close WhatsApp Web/Desktop or stop a duplicate worker, then wait. Next reconnect in ${reconnectMs / 1000}s.`,
          )
        }
        conn.sock = null
        void publishStatus(tenantId, 'disconnected')
        if (shouldReconnect) {
          setTimeout(() => void connectTenant(tenantId).catch(() => {}), reconnectMs)
        } else {
          pool.delete(tenantId)
          console.error(`[wa-pool] ${tenantId.slice(0, 8)} logged out — user must re-scan QR`)
        }
      } else if (connection === 'open') {
        conn.isOpen = true
        conn.connecting = false
        console.log(`[wa-pool] ${tenantId.slice(0, 8)} connected`)
        void publishStatus(tenantId, 'connected')
      }
    })

    // Inbound handling always runs so sequence/auto-reply can fire. Only DB logging is gated (privacy).
    s.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      for (const m of messages) {
        if (!m.key || m.key.fromMe) continue
        const jid = resolveInboundPeerJid(m)
        if (!jid || jid.endsWith('@g.us')) continue
        if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid')) continue
        const text = textFromUpsertMessage(m).trim()
        if (!text) continue
        try {
          const leadId = await findLeadByJid(jid)
          if (!leadId) {
            console.log(`[wa-pool] Inbound from ${jid} — no matching lead found, skipping reply`)
            return
          }
          if (isWhatsappInboundLogEnabled()) {
            await db.insert(outreachLog).values({
              tenantId,
              leadId,
              channel: 'whatsapp',
              direction: 'inbound',
              body: text,
              status: 'received',
              waPeer: jid,
            })
          }
          if (handleInboundReplyFn) {
            handleInboundReplyFn(leadId, jid, text).catch((err) =>
              console.error('[wa-pool] handleInboundReply error:', err instanceof Error ? err.message : err),
            )
          }
        } catch (e) {
          console.warn('[wa-pool] inbound handling failed:', e instanceof Error ? e.message : e)
        }
      }
    })
  } catch (e) {
    conn.connecting = false
    pool.delete(tenantId)
    throw e
  }

  conn.connecting = false
  return conn
}

function evictIdlest() {
  let oldest: TenantConnection | null = null
  for (const conn of pool.values()) {
    if (!oldest || conn.lastActivity < oldest.lastActivity) {
      oldest = conn
    }
  }
  if (oldest) {
    console.log(`[wa-pool] evicting idle tenant ${oldest.tenantId.slice(0, 8)}`)
    disconnectTenant(oldest.tenantId)
  }
}

export function disconnectTenant(tenantId: string) {
  const conn = pool.get(tenantId)
  if (!conn) return
  try { conn.sock?.end(undefined) } catch {}
  conn.sock = null
  conn.isOpen = false
  pool.delete(tenantId)
  void publishStatus(tenantId, 'disconnected')
}

export async function ensureConnected(tenantId: string, maxMs = 120_000): Promise<WASocket> {
  const conn = await connectTenant(tenantId)
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (conn.isOpen && conn.sock) {
      conn.lastActivity = Date.now()
      return conn.sock
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`WhatsApp not connected for tenant ${tenantId.slice(0, 8)} — user must scan QR`)
}

export function getConnection(tenantId: string): TenantConnection | undefined {
  return pool.get(tenantId)
}

export function getPoolStats() {
  return {
    active: pool.size,
    connections: [...pool.values()].map((c) => ({
      tenantId: c.tenantId.slice(0, 8),
      isOpen: c.isOpen,
      lastActivity: c.lastActivity,
    })),
  }
}

/** Suspend idle connections (called periodically). */
export function pruneIdle() {
  const now = Date.now()
  for (const conn of pool.values()) {
    if (conn.isOpen && now - conn.lastActivity > IDLE_TIMEOUT_MS) {
      console.log(`[wa-pool] suspending idle tenant ${conn.tenantId.slice(0, 8)}`)
      disconnectTenant(conn.tenantId)
    }
  }
}

// Legacy compat: connect default tenant from env if WHATSAPP_BAILEYS_ENABLED
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID

const LEGACY_INIT = '__leadiyaWaLegacyConnectDone'

export function initLegacyConnection() {
  if (env.WHATSAPP_BAILEYS_ENABLED !== 'true') return
  const g = globalThis as typeof globalThis & { [LEGACY_INIT]?: boolean }
  if (g[LEGACY_INIT]) return
  g[LEGACY_INIT] = true
  if (DEFAULT_TENANT_ID) {
    console.log(`[wa-pool] Auto-connecting default tenant ${DEFAULT_TENANT_ID.slice(0, 8)}`)
    void connectTenant(DEFAULT_TENANT_ID).catch((e) =>
      console.error('[wa-pool] default tenant connect failed:', e instanceof Error ? e.message : e),
    )
  }
}

export async function sendMessage(
  tenantId: string,
  jid: string,
  body: string,
  leadId?: string | null,
): Promise<void> {
  const sock = await ensureConnected(tenantId)

  const trimmed = body.trim()
  const since = new Date(Date.now() - OUTBOUND_DEDUPE_WINDOW_MS)
  const [dup] = await db
    .select({ id: outreachLog.id })
    .from(outreachLog)
    .where(
      and(
        eq(outreachLog.tenantId, tenantId),
        eq(outreachLog.waPeer, jid),
        eq(outreachLog.direction, 'outbound'),
        eq(outreachLog.body, trimmed),
        gte(outreachLog.createdAt, since),
      ),
    )
    .limit(1)
  if (dup) {
    console.warn(`[wa-pool] skipping duplicate outbound (same peer+body within ${OUTBOUND_DEDUPE_WINDOW_MS / 60000}m)`)
    return
  }

  try {
    await sock.presenceSubscribe(jid)
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000))
    await sock.sendPresenceUpdate('composing', jid)
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000))
    await sock.sendPresenceUpdate('paused', jid)
    await new Promise((r) => setTimeout(r, 300))
  } catch { /* typing simulation is best-effort */ }

  await sock.sendMessage(jid, { text: trimmed })

  try {
    await db.insert(outreachLog).values({
      tenantId,
      leadId: leadId ?? null,
      channel: 'whatsapp',
      direction: 'outbound',
      body: trimmed,
      status: 'sent',
      sentAt: new Date(),
      waPeer: jid,
    })
  } catch (err) {
    console.error('[wa-pool] outreach log insert failed (message was already sent):', err instanceof Error ? err.message : err)
  }
}

setInterval(() => pruneIdle(), 5 * 60 * 1000)

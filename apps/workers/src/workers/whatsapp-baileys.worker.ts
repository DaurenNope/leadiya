import { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { Boom } from '@hapi/boom'
import { pino } from 'pino'
import qrcode from 'qrcode-terminal'
import { parse as parseYaml } from 'yaml'
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys'
import { env } from '@leadiya/config'
import { db, outreachLog } from '@leadiya/db'
import { QueueName, type WhatsAppOutreachJobData } from '@leadiya/queue'

const authDir =
  env.WHATSAPP_BAILEYS_AUTH_DIR?.trim() || resolve(process.cwd(), 'data/baileys-auth')
mkdirSync(authDir, { recursive: true })

function loadAutomationLimits(): {
  maxHour: number
  maxDay: number
  delayMs: number
} {
  try {
    const raw = readFileSync(join(process.cwd(), 'config/business.yml'), 'utf8')
    const doc = parseYaml(raw) as {
      automation?: {
        max_outreach_per_hour?: number
        max_outreach_per_day?: number
        delay_between_messages_ms?: number
      }
    }
    const a = doc.automation ?? {}
    return {
      maxHour: Math.max(1, Number(a.max_outreach_per_hour ?? 10)),
      maxDay: Math.max(1, Number(a.max_outreach_per_day ?? 30)),
      delayMs: Math.max(0, Number(a.delay_between_messages_ms ?? 45_000)),
    }
  } catch {
    return { maxHour: 10, maxDay: 30, delayMs: 45_000 }
  }
}

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })

let sock: WASocket | null = null
let waOpen = false

async function connectToWhatsApp(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const s = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: true,
    browser: ['Leadiya', 'Desktop', '1.0.0'],
  })
  sock = s

  s.ev.on('creds.update', saveCreds)
  s.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      console.log('[whatsapp] Scan QR with WhatsApp → Linked devices')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'close') {
      waOpen = false
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut
      console.warn('[whatsapp] connection closed', lastDisconnect?.error?.message, statusCode)
      sock = null
      if (shouldReconnect) {
        setTimeout(() => void connectToWhatsApp().catch((e) => console.error('[whatsapp] reconnect', e)), 4000)
      } else {
        console.error('[whatsapp] Logged out — clear auth dir and scan QR again:', authDir)
      }
    } else if (connection === 'open') {
      waOpen = true
      console.log('[whatsapp] Baileys session open — outbound queue enabled')
    }
  })
}

void connectToWhatsApp().catch((e) => console.error('[whatsapp] initial connect failed', e))

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitUntilOpen(maxMs = 120_000): Promise<void> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (waOpen && sock) return
    await sleep(500)
  }
  throw new Error('WhatsApp not connected yet — check worker logs and scan QR if needed')
}

async function applyRateLimits(limits: ReturnType<typeof loadAutomationLimits>): Promise<void> {
  const hourKey = `wa:outreach:h:${new Date().toISOString().slice(0, 13)}`
  const dayKey = `wa:outreach:d:${new Date().toISOString().slice(0, 10)}`

  const hourCount = await redis.incr(hourKey)
  if (hourCount === 1) await redis.expire(hourKey, 7200)
  const dayCount = await redis.incr(dayKey)
  if (dayCount === 1) await redis.expire(dayKey, 172800)

  if (hourCount > limits.maxHour) {
    await redis.decr(hourKey)
    await redis.decr(dayKey)
    throw new Error('WHATSAPP_RATE_LIMIT_HOUR')
  }
  if (dayCount > limits.maxDay) {
    await redis.decr(hourKey)
    await redis.decr(dayKey)
    throw new Error('WHATSAPP_RATE_LIMIT_DAY')
  }

  const lastTs = await redis.get('wa:outreach:last_ts')
  const now = Date.now()
  if (lastTs && limits.delayMs > 0) {
    const elapsed = now - Number(lastTs)
    if (elapsed < limits.delayMs) await sleep(limits.delayMs - elapsed)
  }
}

async function markSentTimestamp(): Promise<void> {
  await redis.set('wa:outreach:last_ts', String(Date.now()))
}

const whatsappWorker = new Worker<WhatsAppOutreachJobData>(
  QueueName.WHATSAPP_OUTREACH,
  async (job) => {
    const { leadId, phoneDigits, body } = job.data
    const limits = loadAutomationLimits()
    const jid = `${phoneDigits}@s.whatsapp.net`

    await waitUntilOpen()
    await applyRateLimits(limits)
    if (!sock) throw new Error('Socket lost before send')

    await sock.sendMessage(jid, { text: body })
    await markSentTimestamp()

    await db.insert(outreachLog).values({
      leadId,
      channel: 'whatsapp',
      direction: 'outbound',
      body,
      status: 'sent',
      sentAt: new Date(),
    })

    return { ok: true, jid }
  },
  {
    connection: { url: env.REDIS_URL },
    concurrency: 1,
  }
)

whatsappWorker.on('completed', (job) => {
  console.log(`[whatsapp] sent job ${job.id}`)
})

whatsappWorker.on('failed', (job, err) => {
  console.error(`[whatsapp] job ${job?.id} failed:`, err?.message)
})

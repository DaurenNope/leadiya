import { Hono } from 'hono'
import { Redis } from 'ioredis'
import { exists, or, type SQL } from 'drizzle-orm'
import {
  db,
  leads,
  outreachLog,
  contacts,
  leadSequenceState,
  tenantLeads,
  outreachSequenceDefs,
  eq,
  desc,
  asc,
  and,
  sql,
} from '@leadiya/db'
import { whatsappOutreachQueue } from '@leadiya/queue'
import { env, isWhatsappInboundLogEnabled } from '@leadiya/config'
import { z } from 'zod'
import { leadListFields } from '../lib/lead-select.js'
import { loadBusinessConfig, listSequenceSummariesFromMap } from '../lib/outreach-config.js'
import {
  getMergedSequencesForTenant,
  bustSequenceCachesAfterDbWrite,
} from '../lib/sequence-resolver.js'
import { renderTemplate, buildOutreachVars } from '../lib/render-outreach.js'
import { phoneDigitsForWa, waMeLink } from '../lib/wa-link.js'
import { buildMailtoUrl, splitEmailTemplate } from '../lib/mailto.js'
import type { AppEnv } from '../types.js'

/** Runtime read so tests can `vi.stubEnv('WHATSAPP_BAILEYS_ENABLED', …)` without reloading config. */
function isBaileysSendEnabled(): boolean {
  const v = process.env.WHATSAPP_BAILEYS_ENABLED
  return v === 'true' || v === '1'
}

/** Runtime read so tests can stub `process.env` without reloading the config module. */
function isResendEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim())
}

const MAX_SCHEDULE_DELAY_MS = 7 * 24 * 60 * 60 * 1000

/** Scope outreach_log rows to this tenant: Baileys rows have tenant_id; legacy manual rows may be null but lead is claimed in tenant_leads. */
function tenantOutreachScope(tenantId: string): SQL {
  return or(
    eq(outreachLog.tenantId, tenantId),
    exists(
      db
        .select({ one: sql`1` })
        .from(tenantLeads)
        .where(
          and(eq(tenantLeads.leadId, outreachLog.leadId), eq(tenantLeads.tenantId, tenantId)),
        ),
    ),
  )!
}

/** Match WhatsApp rows even when JID format differs (e.g. @s.whatsapp.net vs @lid) by last 10 digits. */
function waPeerDigitsSuffix(waPeer: string): string | null {
  const digits = waPeer.replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.slice(-10)
}

async function sendEmailViaResend(to: string, subject: string, textBody: string): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim()
  const from = process.env.RESEND_FROM_EMAIL?.trim() || 'onboarding@resend.dev'
  if (!key) throw new Error('RESEND_API_KEY missing')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: subject || '(no subject)',
      text: textBody,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Resend ${res.status}: ${errText.slice(0, 200)}`)
  }
}

const outreachRouter = new Hono<AppEnv>()

/** Prefer JWT tenant; else `DEFAULT_TENANT_ID` so AUTH_BYPASS + env still resolve DB overrides. */
function tenantIdForMerge(c: { get: (k: 'tenant') => unknown }): string | null {
  const tenant = c.get('tenant') as { id: string } | null
  if (tenant?.id) return tenant.id
  return process.env.DEFAULT_TENANT_ID?.trim() || null
}

/** BullMQ payload: JWT tenant, else DEFAULT_TENANT_ID (agent / service key has no tenant row). */
function outreachQueueTenantId(c: { get: (k: 'tenant') => unknown }): string | undefined {
  const tenant = c.get('tenant') as { id: string } | null
  if (tenant?.id) return tenant.id
  const d = process.env.DEFAULT_TENANT_ID?.trim()
  return d || undefined
}

function getScriptsTenantId(c: { get: (k: 'tenant') => unknown }): string | null {
  const tenant = c.get('tenant') as { id: string } | null
  return tenant?.id ?? null
}

/** Maps DB / IO failures on script routes to JSON so the dashboard can show a hint (e.g. missing migration). */
function scriptsRouteError(
  c: { json: (body: unknown, status?: number) => Response },
  err: unknown,
): Response {
  const msg = err instanceof Error ? err.message : String(err)
  const migrationHint =
    /does not exist|42P01|outreach_sequence/i.test(msg)
      ? ' Примените миграции БД из корня репозитория: npm run db:migrate (нужна таблица outreach_sequence_defs).'
      : ''
  console.error('[outreach/scripts]', err)
  return c.json({ error: msg + migrationHint, code: 'SCRIPTS_ERROR' }, 500)
}

outreachRouter.get('/sequences', async (c) => {
  const merged = await getMergedSequencesForTenant(tenantIdForMerge(c))
  return c.json({ sequences: listSequenceSummariesFromMap(merged) })
})

outreachRouter.get('/sequences/:key', async (c) => {
  const key = c.req.param('key')
  const sequences = await getMergedSequencesForTenant(tenantIdForMerge(c))
  const seq = sequences[key]
  if (!seq) return c.json({ error: 'Unknown sequence', code: 'NOT_FOUND' }, 404)
  return c.json({ key, ...seq })
})

outreachRouter.get('/business', (c) => {
  const b = loadBusinessConfig()
  const company = b.company as Record<string, unknown> | undefined
  const voice = b.voice as Record<string, unknown> | undefined
  return c.json({
    company: {
      name: company?.name,
      calendar_url: company?.calendar_url,
      website: company?.website,
    },
    voice: { signature: voice?.signature },
    whatsapp_baileys_send: isBaileysSendEnabled(),
    whatsapp_inbound_log: isWhatsappInboundLogEnabled(),
    email_api_send: isResendEmailEnabled(),
  })
})

const previewSchema = z.object({
  leadId: z.string().uuid(),
  sequenceKey: z.string().min(1).default('cold_outreach'),
  stepIndex: z.coerce.number().int().min(0).default(0),
  /** When the lead row has no WhatsApp / phone, UI can pass a number for wa.me preview. */
  phoneOverride: z.string().optional(),
  /** When the lead row has no email, UI can pass an address for mailto preview. */
  emailOverride: z.string().optional(),
})

outreachRouter.post('/preview', async (c) => {
  const parsed = previewSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.format() }, 400)
  }

  const { leadId, sequenceKey, stepIndex, phoneOverride, emailOverride } = parsed.data
  const [lead] = await db
    .select(leadListFields)
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1)
  if (!lead) return c.json({ error: 'Lead not found', code: 'NOT_FOUND' }, 404)

  const sequences = await getMergedSequencesForTenant(tenantIdForMerge(c))
  const seq = sequences[sequenceKey]
  if (!seq) return c.json({ error: 'Unknown sequence', code: 'NOT_FOUND' }, 404)

  const step = seq.steps[stepIndex]
  if (!step) return c.json({ error: 'Invalid step index', code: 'VALIDATION_ERROR' }, 400)

  const business = loadBusinessConfig()
  const vars = buildOutreachVars(lead, business)
  const rendered = renderTemplate(step.template, vars)

  const contactRows = await db.select().from(contacts).where(eq(contacts.leadId, leadId)).limit(5)

  if (step.channel === 'email') {
    const fromLeadEmail = lead.email?.trim() || null
    const fromContactEmail =
      contactRows.map((r) => r.email?.trim()).find((e) => Boolean(e && e.includes('@'))) ?? null
    const fromOverrideEmail = emailOverride?.trim() || null
    const emailTo = fromOverrideEmail || fromLeadEmail || fromContactEmail
    const { subject, body: mailBody } = splitEmailTemplate(rendered)
    const mailtoLink = emailTo ? buildMailtoUrl(emailTo, mailBody || rendered, subject) : null

    return c.json({
      sequenceKey,
      stepIndex,
      stepId: step.id,
      channel: 'email',
      body: rendered,
      waLink: null,
      phoneDigits: null,
      mailtoLink,
      emailTo,
    })
  }

  const fromLead = phoneDigitsForWa(lead.whatsapp)
  const fromContact = contactRows.map((r) => phoneDigitsForWa(r.phone)).find(Boolean) ?? null
  const fromOverride = phoneOverride?.trim() ? phoneDigitsForWa(phoneOverride) : null
  const digits = fromOverride || fromLead || fromContact

  const waLink = step.channel === 'whatsapp' && digits ? waMeLink(digits, rendered) : null

  return c.json({
    sequenceKey,
    stepIndex,
    stepId: step.id,
    channel: step.channel,
    body: rendered,
    waLink,
    phoneDigits: digits,
    mailtoLink: null,
    emailTo: null,
  })
})

outreachRouter.get('/log', async (c) => {
  const leadId = c.req.query('leadId')?.trim()
  const waPeerRaw = c.req.query('waPeer')?.trim()
  const limitRaw = c.req.query('limit')
  const orderRaw = c.req.query('order')?.trim()?.toLowerCase()
  const limit = Math.min(500, Math.max(1, parseInt(limitRaw ?? '50', 10) || 50))
  const channel = c.req.query('channel')?.trim()
  const tenant = c.get('tenant') as { id: string } | null
  const tenantId = tenant?.id

  const logSelect = {
    id: outreachLog.id,
    tenantId: outreachLog.tenantId,
    leadId: outreachLog.leadId,
    contactId: outreachLog.contactId,
    channel: outreachLog.channel,
    direction: outreachLog.direction,
    body: outreachLog.body,
    status: outreachLog.status,
    sentAt: outreachLog.sentAt,
    waPeer: outreachLog.waPeer,
    createdAt: outreachLog.createdAt,
    updatedAt: outreachLog.updatedAt,
    leadName: leads.name,
    leadCity: leads.city,
  }

  try {
    /** Full thread for one peer — avoids truncating when the global "last N rows" omits older messages in this chat. */
    if (waPeerRaw) {
      const conds: SQL[] = []
      if (channel) conds.push(eq(outreachLog.channel, channel))
      if (tenantId) conds.push(tenantOutreachScope(tenantId))

      const suffix = waPeerDigitsSuffix(waPeerRaw)
      const peerClause =
        suffix != null
          ? sql`right(regexp_replace(coalesce(${outreachLog.waPeer}::text, ''), '[^0-9]', '', 'g'), 10) = ${suffix}`
          : eq(outreachLog.waPeer, waPeerRaw)

      const uuidOk = leadId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(leadId)
      if (uuidOk) {
        conds.push(or(peerClause, eq(outreachLog.leadId, leadId!))!)
      } else {
        conds.push(peerClause)
      }

      const orderAsc = orderRaw === 'desc' ? false : true

      const rows = await db
        .select(logSelect)
        .from(outreachLog)
        .leftJoin(leads, eq(outreachLog.leadId, leads.id))
        .where(and(...conds))
        .orderBy(orderAsc ? asc(outreachLog.createdAt) : desc(outreachLog.createdAt))
        .limit(Math.min(limit, 500))

      return c.json({ items: rows })
    }

    if (leadId) {
      const conditions = [eq(outreachLog.leadId, leadId)]
      if (tenantId) conditions.push(tenantOutreachScope(tenantId))
      const rows = await db
        .select()
        .from(outreachLog)
        .where(and(...conditions))
        .orderBy(desc(outreachLog.createdAt))
        .limit(Math.min(limit, 100))

      return c.json({ items: rows })
    }

    const conds: SQL[] = []
    if (channel) conds.push(eq(outreachLog.channel, channel))
    if (tenantId) conds.push(tenantOutreachScope(tenantId))

    const listLimit = Math.min(limit, 200)
    const rows = await db
      .select(logSelect)
      .from(outreachLog)
      .leftJoin(leads, eq(outreachLog.leadId, leads.id))
      .where(conds.length ? and(...conds) : sql`true`)
      .orderBy(desc(outreachLog.createdAt))
      .limit(listLimit)

    return c.json({ items: rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/column .*lead_id.* does not exist/i.test(msg)) {
      return c.json({
        items: [],
        warning: 'outreach_log schema mismatch: lead_id missing (run latest DB migrations)',
      })
    }
    throw err
  }
})

const logSchema = z.object({
  leadId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  channel: z.string().min(1),
  direction: z.enum(['outbound', 'inbound']).default('outbound'),
  body: z.string().min(1),
  status: z.string().optional().default('logged'),
})

const sendSchema = z.object({
  leadId: z.string().uuid(),
  sequenceKey: z.string().min(1).default('cold_outreach'),
  stepIndex: z.coerce.number().int().min(0).default(0),
  body: z.string().min(1).optional(),
  phoneOverride: z.string().optional(),
})

/** Quick send from dashboard inbox: phone + body, no lead. */
const directWaSendSchema = z.object({
  channel: z.literal('whatsapp'),
  phone: z.string().min(1),
  body: z.string().min(1),
})

outreachRouter.post('/send', async (c) => {
  if (!isBaileysSendEnabled()) {
    return c.json(
      { error: 'WhatsApp Baileys send is disabled on the API', code: 'WHATSAPP_BAILEYS_DISABLED' },
      503
    )
  }

  const queueTenantId = outreachQueueTenantId(c)

  const rawBody = await c.req.json()
  const direct = directWaSendSchema.safeParse(rawBody)
  if (direct.success) {
    const digits = phoneDigitsForWa(direct.data.phone)
    if (!digits) {
      return c.json({ error: 'Invalid or empty phone number', code: 'VALIDATION_ERROR' }, 400)
    }
    const job = await whatsappOutreachQueue.add(
      'send',
      { phoneDigits: digits, body: direct.data.body.trim(), tenantId: queueTenantId },
      { removeOnComplete: true }
    )
    return c.json({ queued: true, jobId: job.id }, 202)
  }

  const parsed = sendSchema.safeParse(rawBody)
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.format() }, 400)
  }

  const { leadId, sequenceKey, stepIndex, body: bodyOverride, phoneOverride } = parsed.data
  const [lead] = await db
    .select(leadListFields)
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1)
  if (!lead) return c.json({ error: 'Lead not found', code: 'NOT_FOUND' }, 404)

  const sequences = await getMergedSequencesForTenant(tenantIdForMerge(c))
  const seq = sequences[sequenceKey]
  if (!seq) return c.json({ error: 'Unknown sequence', code: 'NOT_FOUND' }, 404)

  const step = seq.steps[stepIndex]
  if (!step) return c.json({ error: 'Invalid step index', code: 'VALIDATION_ERROR' }, 400)
  if (step.channel !== 'whatsapp') {
    return c.json({ error: 'This step is not a WhatsApp channel', code: 'VALIDATION_ERROR' }, 400)
  }

  const business = loadBusinessConfig()
  const vars = buildOutreachVars(lead, business)
  const rendered = bodyOverride?.trim() ? bodyOverride.trim() : renderTemplate(step.template, vars)

  const fromLead = phoneDigitsForWa(lead.whatsapp)
  const contactRows = await db.select().from(contacts).where(eq(contacts.leadId, leadId)).limit(5)
  const fromContact = contactRows.map((r) => phoneDigitsForWa(r.phone)).find(Boolean) ?? null
  const fromOverride = phoneOverride?.trim() ? phoneDigitsForWa(phoneOverride) : null
  const digits = fromOverride || fromLead || fromContact
  if (!digits) {
    return c.json({ error: 'No WhatsApp number for this lead', code: 'NO_PHONE' }, 400)
  }

  const job = await whatsappOutreachQueue.add(
    'send',
    {
      leadId,
      phoneDigits: digits,
      body: rendered,
      sequenceKey,
      stepIndex,
      tenantId: queueTenantId,
    },
    { removeOnComplete: true }
  )

  return c.json({ queued: true, jobId: job.id }, 202)
})

const scheduleSchema = sendSchema.extend({
  delayMs: z.coerce.number().int().min(0).max(MAX_SCHEDULE_DELAY_MS),
})

outreachRouter.post('/schedule', async (c) => {
  if (!isBaileysSendEnabled()) {
    return c.json(
      { error: 'WhatsApp Baileys send is disabled on the API', code: 'WHATSAPP_BAILEYS_DISABLED' },
      503
    )
  }

  const queueTenantId = outreachQueueTenantId(c)

  const parsed = scheduleSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.format() }, 400)
  }

  const { leadId, sequenceKey, stepIndex, body: bodyOverride, phoneOverride, delayMs } = parsed.data
  const [lead] = await db
    .select(leadListFields)
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1)
  if (!lead) return c.json({ error: 'Lead not found', code: 'NOT_FOUND' }, 404)

  const sequences = await getMergedSequencesForTenant(tenantIdForMerge(c))
  const seq = sequences[sequenceKey]
  if (!seq) return c.json({ error: 'Unknown sequence', code: 'NOT_FOUND' }, 404)

  const step = seq.steps[stepIndex]
  if (!step) return c.json({ error: 'Invalid step index', code: 'VALIDATION_ERROR' }, 400)
  if (step.channel !== 'whatsapp') {
    return c.json({ error: 'This step is not a WhatsApp channel', code: 'VALIDATION_ERROR' }, 400)
  }

  const business = loadBusinessConfig()
  const vars = buildOutreachVars(lead, business)
  const rendered = bodyOverride?.trim() ? bodyOverride.trim() : renderTemplate(step.template, vars)

  const fromLead = phoneDigitsForWa(lead.whatsapp)
  const contactRows = await db.select().from(contacts).where(eq(contacts.leadId, leadId)).limit(5)
  const fromContact = contactRows.map((r) => phoneDigitsForWa(r.phone)).find(Boolean) ?? null
  const fromOverride = phoneOverride?.trim() ? phoneDigitsForWa(phoneOverride) : null
  const digits = fromOverride || fromLead || fromContact
  if (!digits) {
    return c.json({ error: 'No WhatsApp number for this lead', code: 'NO_PHONE' }, 400)
  }

  const job = await whatsappOutreachQueue.add(
    'send',
    {
      leadId,
      phoneDigits: digits,
      body: rendered,
      sequenceKey,
      stepIndex,
      tenantId: queueTenantId,
    },
    { delay: delayMs, removeOnComplete: true }
  )

  return c.json({ queued: true, jobId: job.id, delayMs, scheduled: true }, 202)
})

const sendEmailSchema = z.object({
  leadId: z.string().uuid(),
  sequenceKey: z.string().min(1).default('cold_outreach'),
  stepIndex: z.coerce.number().int().min(0).default(0),
  body: z.string().min(1).optional(),
  emailOverride: z.string().email().optional(),
})

outreachRouter.post('/send-email', async (c) => {
  if (!isResendEmailEnabled()) {
    return c.json(
      { error: 'Email API (Resend) is not configured on the API', code: 'EMAIL_API_DISABLED' },
      503
    )
  }

  const parsed = sendEmailSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.format() }, 400)
  }

  const { leadId, sequenceKey, stepIndex, body: bodyOverride, emailOverride } = parsed.data
  const [lead] = await db
    .select(leadListFields)
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1)
  if (!lead) return c.json({ error: 'Lead not found', code: 'NOT_FOUND' }, 404)

  const sequences = await getMergedSequencesForTenant(tenantIdForMerge(c))
  const seq = sequences[sequenceKey]
  if (!seq) return c.json({ error: 'Unknown sequence', code: 'NOT_FOUND' }, 404)

  const step = seq.steps[stepIndex]
  if (!step) return c.json({ error: 'Invalid step index', code: 'VALIDATION_ERROR' }, 400)
  if (step.channel !== 'email') {
    return c.json({ error: 'This step is not an email channel', code: 'VALIDATION_ERROR' }, 400)
  }

  const contactRows = await db.select().from(contacts).where(eq(contacts.leadId, leadId)).limit(5)
  const fromLeadEmail = lead.email?.trim() || null
  const fromContactEmail =
    contactRows.map((r) => r.email?.trim()).find((e) => Boolean(e && e.includes('@'))) ?? null
  const emailTo = (emailOverride?.trim() || fromLeadEmail || fromContactEmail)?.trim()
  if (!emailTo) {
    return c.json({ error: 'No email address for this lead', code: 'NO_EMAIL' }, 400)
  }

  const business = loadBusinessConfig()
  const vars = buildOutreachVars(lead, business)
  const rendered = bodyOverride?.trim() ? bodyOverride.trim() : renderTemplate(step.template, vars)
  const { subject, body: mailBody } = splitEmailTemplate(rendered)
  const textOut = mailBody || rendered

  await sendEmailViaResend(emailTo, subject, textOut)

  const tenant = c.get('tenant') as { id: string } | null
  const [row] = await db
    .insert(outreachLog)
    .values({
      tenantId: tenant?.id ?? null,
      leadId,
      channel: 'email',
      direction: 'outbound',
      body: rendered,
      status: 'sent',
      sentAt: new Date(),
    })
    .returning()

  return c.json({ sent: true, logId: row?.id, emailTo }, 201)
})

outreachRouter.post('/log', async (c) => {
  const parsed = logSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.format() }, 400)
  }

  const d = parsed.data
  const tenant = c.get('tenant') as { id: string } | null
  const [row] = await db
    .insert(outreachLog)
    .values({
      tenantId: tenant?.id ?? null,
      leadId: d.leadId,
      contactId: d.contactId ?? null,
      channel: d.channel,
      direction: d.direction,
      body: d.body,
      status: d.status,
      sentAt: d.status === 'sent' ? new Date() : null,
    })
    .returning()

  return c.json(row, 201)
})

let _redis: Redis | null = null
function getRedis(): Redis {
  if (!_redis) _redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true })
  return _redis
}

outreachRouter.get('/whatsapp/status', async (c) => {
  const redis = getRedis()
  const tenant = c.get('tenant') as { id: string } | null
  const defaultTid = process.env.DEFAULT_TENANT_ID?.trim()
  /** Worker always publishes `wa:status:<uuid>` (never legacy `wa:connection:*`). Align with Baileys init when JWT has no tenant row yet. */
  const effectiveTenantId = tenant?.id ?? defaultTid ?? null

  const statusKeyPrefix = effectiveTenantId ? `wa:status:${effectiveTenantId}` : 'wa:connection:status'
  const qrKeyPrefix = effectiveTenantId ? `wa:qr:${effectiveTenantId}` : 'wa:connection:qr'

  const [statusRaw, qr] = await Promise.all([
    redis.get(statusKeyPrefix),
    redis.get(qrKeyPrefix),
  ])
  const parsed = statusRaw ? JSON.parse(statusRaw) as { status: string; updatedAt: number } : null
  return c.json({
    status: parsed?.status ?? 'unknown',
    updatedAt: parsed?.updatedAt ?? null,
    qr: qr ?? null,
    baileysSendEnabled: isBaileysSendEnabled(),
  })
})

function parseSequenceDelay(delay: string | number | undefined): number {
  if (delay == null) return 0
  if (typeof delay === 'number') return delay
  const m = String(delay).match(/^(\d+)(ms|s|m|h|d)$/)
  if (!m) return 0
  const v = parseInt(m[1]!, 10)
  const u: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return v * (u[m[2]!] ?? 0)
}

const sequenceStepPutSchema = z.object({
  id: z.string().min(1),
  channel: z.enum(['whatsapp', 'email']),
  template: z.string().min(1).max(16_000),
  delay: z.union([z.string(), z.number()]).optional(),
  condition: z.string().max(200).optional(),
})

const sequenceDefPutSchema = z.object({
  trigger: z.string().min(1).max(500),
  steps: z.array(sequenceStepPutSchema).min(1).max(40),
})

// ── Tenant script overrides (DB) — GET/PUT/DELETE ─────────────

outreachRouter.get('/scripts', async (c) => {
  try {
    const tenantId = getScriptsTenantId(c)
    if (!tenantId) return c.json({ error: 'Tenant required', code: 'TENANT_REQUIRED' }, 403)

    const overrideRows = await db
      .select({ sequenceKey: outreachSequenceDefs.sequenceKey })
      .from(outreachSequenceDefs)
      .where(eq(outreachSequenceDefs.tenantId, tenantId))
    const overridden = new Set(overrideRows.map((r) => r.sequenceKey))

    const merged = await getMergedSequencesForTenant(tenantId)
    const sequences = listSequenceSummariesFromMap(merged).map((s) => ({
      ...s,
      isOverridden: overridden.has(s.key),
    }))
    return c.json({ sequences })
  } catch (err) {
    return scriptsRouteError(c, err)
  }
})

outreachRouter.get('/scripts/:key', async (c) => {
  try {
    const tenantId = getScriptsTenantId(c)
    if (!tenantId) return c.json({ error: 'Tenant required', code: 'TENANT_REQUIRED' }, 403)

    const key = c.req.param('key')
    const overrideRows = await db
      .select({ id: outreachSequenceDefs.id })
      .from(outreachSequenceDefs)
      .where(and(eq(outreachSequenceDefs.tenantId, tenantId), eq(outreachSequenceDefs.sequenceKey, key)))
      .limit(1)
    const isOverridden = Boolean(overrideRows[0])

    const merged = await getMergedSequencesForTenant(tenantId)
    const seq = merged[key]
    if (!seq) return c.json({ error: 'Unknown sequence', code: 'NOT_FOUND' }, 404)

    return c.json({ key, isOverridden, ...seq })
  } catch (err) {
    return scriptsRouteError(c, err)
  }
})

outreachRouter.put('/scripts/:key', async (c) => {
  try {
    const tenantId = getScriptsTenantId(c)
    if (!tenantId) return c.json({ error: 'Tenant required', code: 'TENANT_REQUIRED' }, 403)

    const key = c.req.param('key')
    const parsed = sequenceDefPutSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.format() }, 400)
    }

    const def = parsed.data
    const now = new Date()

    const existing = await db
      .select({ id: outreachSequenceDefs.id })
      .from(outreachSequenceDefs)
      .where(and(eq(outreachSequenceDefs.tenantId, tenantId), eq(outreachSequenceDefs.sequenceKey, key)))
      .limit(1)

    if (existing[0]) {
      await db
        .update(outreachSequenceDefs)
        .set({ definition: def, updatedAt: now })
        .where(eq(outreachSequenceDefs.id, existing[0].id))
    } else {
      await db.insert(outreachSequenceDefs).values({
        tenantId,
        sequenceKey: key,
        definition: def,
        updatedAt: now,
      })
    }

    bustSequenceCachesAfterDbWrite()
    return c.json({ ok: true, key })
  } catch (err) {
    return scriptsRouteError(c, err)
  }
})

outreachRouter.delete('/scripts/:key', async (c) => {
  try {
    const tenantId = getScriptsTenantId(c)
    if (!tenantId) return c.json({ error: 'Tenant required', code: 'TENANT_REQUIRED' }, 403)

    const key = c.req.param('key')
    await db
      .delete(outreachSequenceDefs)
      .where(and(eq(outreachSequenceDefs.tenantId, tenantId), eq(outreachSequenceDefs.sequenceKey, key)))

    bustSequenceCachesAfterDbWrite()
    return c.json({ ok: true, key })
  } catch (err) {
    return scriptsRouteError(c, err)
  }
})

// ── Sequence Management ──────────────────────────────────────

outreachRouter.post('/sequences/start', async (c) => {
  const body = await c.req.json()
  const { leadId, sequenceKey = 'cold_outreach', contactId } = body as { leadId?: string; sequenceKey?: string; contactId?: string }
  if (!leadId) return c.json({ error: 'leadId required' }, 400)

  const [coolRow] = await db
    .select({ nextOutreachEligibleAt: leads.nextOutreachEligibleAt })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1)
  if (coolRow?.nextOutreachEligibleAt && coolRow.nextOutreachEligibleAt.getTime() > Date.now()) {
    return c.json(
      {
        error: 'Lead on outreach cooldown',
        code: 'COOLDOWN',
        until: coolRow.nextOutreachEligibleAt.toISOString(),
      },
      429,
    )
  }

  const tenant = c.get('tenant') as { id: string } | null
  const tenantId = tenant?.id ?? null

  const merged = await getMergedSequencesForTenant(tenantIdForMerge(c))
  const seq = merged[sequenceKey]
  if (!seq) return c.json({ error: 'Unknown sequence', code: 'NOT_FOUND' }, 404)

  const now = new Date()
  const secondStep = seq.steps[1]
  const nextStepAt = secondStep ? new Date(now.getTime() + parseSequenceDelay(secondStep.delay)) : null

  const [state] = await db
    .insert(leadSequenceState)
    .values({
      tenantId,
      leadId,
      contactId: contactId ?? null,
      sequenceKey,
      currentStep: 0,
      status: 'active',
      intent: 'unknown',
      startedAt: now,
      lastOutreachAt: now,
      nextStepAt,
    })
    .onConflictDoNothing()
    .returning()

  return c.json({ started: Boolean(state), stateId: state?.id ?? null })
})

outreachRouter.get('/sequences/active', async (c) => {
  const limitRaw = c.req.query('limit')
  const limit = Math.min(100, parseInt(limitRaw ?? '50', 10) || 50)

  const rows = await db
    .select({
      id: leadSequenceState.id,
      leadId: leadSequenceState.leadId,
      sequenceKey: leadSequenceState.sequenceKey,
      currentStep: leadSequenceState.currentStep,
      status: leadSequenceState.status,
      intent: leadSequenceState.intent,
      lastOutreachAt: leadSequenceState.lastOutreachAt,
      lastReplyAt: leadSequenceState.lastReplyAt,
      nextStepAt: leadSequenceState.nextStepAt,
      messageCount: leadSequenceState.messageCount,
      qualificationData: leadSequenceState.qualificationData,
      leadName: leads.name,
      leadCity: leads.city,
      leadCategory: leads.category,
    })
    .from(leadSequenceState)
    .innerJoin(leads, eq(leadSequenceState.leadId, leads.id))
    .where(eq(leadSequenceState.status, 'active'))
    .orderBy(desc(leadSequenceState.updatedAt))
    .limit(limit)

  return c.json({ items: rows })
})

// ── Resend Inbound Webhook ───────────────────────────────────

outreachRouter.post('/webhook/resend-inbound', async (c) => {
  const payload = await c.req.json()
  const from = payload.from as string | undefined
  const subject = payload.subject as string | undefined
  const text = payload.text as string | undefined

  if (!from || !text) {
    return c.json({ received: true, processed: false, reason: 'missing fields' })
  }

  const [lead] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(sql`${leads.email} = ${from}`)
    .limit(1)

  await db.insert(outreachLog).values({
    leadId: lead?.id ?? null,
    channel: 'email',
    direction: 'inbound',
    body: subject ? `Тема: ${subject}\n\n${text}` : text,
    status: 'received',
  })

  return c.json({ received: true, processed: true, leadId: lead?.id ?? null })
})

export { outreachRouter }

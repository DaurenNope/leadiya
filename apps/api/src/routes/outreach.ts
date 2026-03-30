import { Hono } from 'hono'
import { Redis } from 'ioredis'
import { db, leads, outreachLog, contacts, leadSequenceState, eq, desc, and, sql } from '@leadiya/db'
import { whatsappOutreachQueue } from '@leadiya/queue'
import { env } from '@leadiya/config'
import { z } from 'zod'
import { leadListFields } from '../lib/lead-select.js'
import { loadOutreachSequences, loadBusinessConfig, listSequenceSummaries } from '../lib/outreach-config.js'
import { renderTemplate, buildOutreachVars } from '../lib/render-outreach.js'
import { phoneDigitsForWa, waMeLink } from '../lib/wa-link.js'
import { buildMailtoUrl, splitEmailTemplate } from '../lib/mailto.js'
import type { AppEnv } from '../types.js'

function isBaileysSendEnabled(): boolean {
  const v = env.WHATSAPP_BAILEYS_ENABLED
  return v === 'true' || v === '1'
}

/** Runtime read so tests can stub `process.env` without reloading the config module. */
function isResendEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim())
}

const MAX_SCHEDULE_DELAY_MS = 7 * 24 * 60 * 60 * 1000

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

outreachRouter.get('/sequences', (c) => {
  return c.json({ sequences: listSequenceSummaries() })
})

outreachRouter.get('/sequences/:key', (c) => {
  const key = c.req.param('key')
  const sequences = loadOutreachSequences()
  const seq = sequences[key]
  if (!seq) return c.json({ error: 'Unknown sequence', code: 'NOT_FOUND' }, 404)
  return c.json({ key, ...seq })
})

outreachRouter.get('/business', (c) => {
  const b = loadBusinessConfig()
  const company = b.company as Record<string, unknown> | undefined
  const voice = b.voice as Record<string, unknown> | undefined
  const inbound = env.WHATSAPP_INBOUND_LOG
  return c.json({
    company: {
      name: company?.name,
      calendar_url: company?.calendar_url,
      website: company?.website,
    },
    voice: { signature: voice?.signature },
    whatsapp_baileys_send: isBaileysSendEnabled(),
    whatsapp_inbound_log: inbound === 'true' || inbound === '1',
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

  const sequences = loadOutreachSequences()
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
  const limitRaw = c.req.query('limit')
  const limit = Math.min(200, Math.max(1, parseInt(limitRaw ?? '50', 10) || 50))
  const channel = c.req.query('channel')?.trim()

  try {
    if (leadId) {
      const rows = await db
        .select()
        .from(outreachLog)
        .where(eq(outreachLog.leadId, leadId))
        .orderBy(desc(outreachLog.createdAt))
        .limit(Math.min(limit, 100))

      return c.json({ items: rows })
    }

    const conds = []
    if (channel) conds.push(eq(outreachLog.channel, channel))

    const rows = await db
      .select({
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
      })
      .from(outreachLog)
      .leftJoin(leads, eq(outreachLog.leadId, leads.id))
      .where(conds.length ? and(...conds) : sql`true`)
      .orderBy(desc(outreachLog.createdAt))
      .limit(limit)

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

  const rawBody = await c.req.json()
  const direct = directWaSendSchema.safeParse(rawBody)
  if (direct.success) {
    const digits = phoneDigitsForWa(direct.data.phone)
    if (!digits) {
      return c.json({ error: 'Invalid or empty phone number', code: 'VALIDATION_ERROR' }, 400)
    }
    const job = await whatsappOutreachQueue.add(
      'send',
      { phoneDigits: digits, body: direct.data.body.trim() },
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

  const sequences = loadOutreachSequences()
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

  const sequences = loadOutreachSequences()
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

  const sequences = loadOutreachSequences()
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

  const [row] = await db
    .insert(outreachLog)
    .values({
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
  const [row] = await db
    .insert(outreachLog)
    .values({
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
  const tenantId = tenant?.id

  const statusKeyPrefix = tenantId ? `wa:status:${tenantId}` : 'wa:connection:status'
  const qrKeyPrefix = tenantId ? `wa:qr:${tenantId}` : 'wa:connection:qr'

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

// ── Sequence Management ──────────────────────────────────────

outreachRouter.post('/sequences/start', async (c) => {
  const body = await c.req.json()
  const { leadId, sequenceKey = 'cold_outreach', contactId } = body as { leadId?: string; sequenceKey?: string; contactId?: string }
  if (!leadId) return c.json({ error: 'leadId required' }, 400)

  const now = new Date()
  const [state] = await db
    .insert(leadSequenceState)
    .values({
      leadId,
      contactId: contactId ?? null,
      sequenceKey,
      currentStep: 0,
      status: 'active',
      intent: 'unknown',
      startedAt: now,
      lastOutreachAt: now,
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

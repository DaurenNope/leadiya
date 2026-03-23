import { Hono } from 'hono'
import { db, leads, outreachLog, contacts, eq, desc } from '@leadiya/db'
import { whatsappOutreachQueue } from '@leadiya/queue'
import { env } from '@leadiya/config'
import { z } from 'zod'
import { leadListFields } from '../lib/lead-select.js'
import { loadOutreachSequences, loadBusinessConfig, listSequenceSummaries } from '../lib/outreach-config.js'
import { renderTemplate, buildOutreachVars } from '../lib/render-outreach.js'
import { phoneDigitsForWa, waMeLink } from '../lib/wa-link.js'
import type { AppEnv } from '../server.js'

function isBaileysSendEnabled(): boolean {
  const v = env.WHATSAPP_BAILEYS_ENABLED
  return v === 'true' || v === '1'
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
  return c.json({
    company: {
      name: company?.name,
      calendar_url: company?.calendar_url,
      website: company?.website,
    },
    voice: { signature: voice?.signature },
    whatsapp_baileys_send: isBaileysSendEnabled(),
  })
})

const previewSchema = z.object({
  leadId: z.string().uuid(),
  sequenceKey: z.string().min(1).default('cold_outreach'),
  stepIndex: z.coerce.number().int().min(0).default(0),
})

outreachRouter.post('/preview', async (c) => {
  const parsed = previewSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.format() }, 400)
  }

  const { leadId, sequenceKey, stepIndex } = parsed.data
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

  const fromLead = phoneDigitsForWa(lead.whatsapp)
  const contactRows = await db.select().from(contacts).where(eq(contacts.leadId, leadId)).limit(5)
  const fromContact = contactRows.map((r) => phoneDigitsForWa(r.phone)).find(Boolean) ?? null
  const digits = fromLead || fromContact

  const waLink =
    step.channel === 'whatsapp' && digits ? waMeLink(digits, rendered) : null

  return c.json({
    sequenceKey,
    stepIndex,
    stepId: step.id,
    channel: step.channel,
    body: rendered,
    waLink,
    phoneDigits: digits,
  })
})

outreachRouter.get('/log', async (c) => {
  const leadId = c.req.query('leadId')
  if (!leadId) return c.json({ error: 'leadId required', code: 'VALIDATION_ERROR' }, 400)

  const rows = await db
    .select()
    .from(outreachLog)
    .where(eq(outreachLog.leadId, leadId))
    .orderBy(desc(outreachLog.createdAt))
    .limit(50)

  return c.json({ items: rows })
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
})

outreachRouter.post('/send', async (c) => {
  if (!isBaileysSendEnabled()) {
    return c.json(
      { error: 'WhatsApp Baileys send is disabled on the API', code: 'WHATSAPP_BAILEYS_DISABLED' },
      503
    )
  }

  const parsed = sendSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.format() }, 400)
  }

  const { leadId, sequenceKey, stepIndex, body: bodyOverride } = parsed.data
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
  const digits = fromLead || fromContact
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

export { outreachRouter }

import cron from 'node-cron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { db, leads, contacts, outreachLog, leadSequenceState, eq, sql, and, desc } from '@leadiya/db'
import { whatsappOutreachQueue, emailOutreachQueue } from '@leadiya/queue'
import { classifyReply, type ClassifyResult } from '../lib/intent-classifier.js'
import { generateResponse, extractQualificationFromMessage, type ResponseContext } from '../lib/auto-responder.js'
import { processReferral } from '../lib/contact-extractor.js'

interface SequenceStep {
  id: string
  delay: string | number
  channel: 'whatsapp' | 'email'
  condition?: string
  template: string
}

interface SequenceDef {
  trigger: string
  cooldown?: string
  steps: SequenceStep[]
}

let _sequences: Record<string, SequenceDef> | null = null

function loadSequences(): Record<string, SequenceDef> {
  if (_sequences) return _sequences
  try {
    const raw = readFileSync(join(process.cwd(), 'config', 'sequences.yml'), 'utf8')
    const doc = parseYaml(raw) as { sequences?: Record<string, SequenceDef> }
    _sequences = doc.sequences ?? {}
  } catch { _sequences = {} }
  return _sequences
}

function parseDelay(delay: string | number): number {
  if (typeof delay === 'number') return delay
  const m = delay.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!m) return 0
  const v = parseInt(m[1])
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return v * (units[m[2]] ?? 0)
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '')
}

function buildVars(lead: { name?: string | null; category?: string | null; city?: string | null }): Record<string, string> {
  return {
    company: lead.name?.trim() || 'Компания',
    first_name: process.env.OUTREACH_DEFAULT_FIRST_NAME ?? 'коллега',
    industry: lead.category?.trim() || 'вашей отрасли',
    city: lead.city?.trim() || '',
    calendar_url: 'https://cal.com/rahmetlabs/30min',
    signature: '— Команда Rahmet Labs',
    our_name: 'Rahmet Labs',
  }
}

function resolvePhoneFromWaPeer(jid: string): string | null {
  const digits = jid.replace(/@.*/, '').replace(/\D/g, '')
  return digits.length >= 10 ? digits : null
}

// ── Inbound Reply Handler ────────────────────────────────────

export async function handleInboundReply(leadId: string | null, waPeer: string, messageBody: string) {
  if (!leadId) return

  const [state] = await db
    .select()
    .from(leadSequenceState)
    .where(and(eq(leadSequenceState.leadId, leadId), eq(leadSequenceState.status, 'active')))
    .limit(1)

  if (!state) return

  let classification: ClassifyResult
  try {
    classification = await classifyReply(messageBody)
  } catch (err) {
    console.error(`[sequence-engine] classifyReply failed for lead ${leadId}:`, err instanceof Error ? err.message : err)
    classification = { intent: 'unknown', confidence: 'low' }
  }
  console.log(`[sequence-engine] Lead ${leadId}: intent=${classification.intent} (${classification.confidence})`)

  // Extract qualification data from message
  const currentQD = (state.qualificationData ?? {}) as Record<string, unknown>
  const newQD = extractQualificationFromMessage(messageBody, currentQD)
  const mergedQD = { ...currentQD, ...newQD }

  // Determine effective intent: if we're in qualification mode and they're answering questions
  let effectiveIntent = classification.intent
  if (Object.keys(newQD).length > 0 && (classification.intent === 'positive' || classification.intent === 'question' || classification.intent === 'unknown')) {
    effectiveIntent = 'qualification'
  }

  // Update sequence state
  await db
    .update(leadSequenceState)
    .set({
      intent: effectiveIntent,
      lastReplyAt: new Date(),
      messageCount: sql`${leadSequenceState.messageCount} + 1`,
      qualificationData: mergedQD,
      updatedAt: new Date(),
    })
    .where(eq(leadSequenceState.id, state.id))

  // Handle referral
  if (classification.intent === 'referral' && classification.referralContact?.phone) {
    await processReferral(leadId, { name: classification.referralContact.name, phone: classification.referralContact.phone }, state.sequenceKey)
  }

  // Handle negative — stop sequence
  if (classification.intent === 'negative') {
    await db.update(leadSequenceState).set({ status: 'cold', updatedAt: new Date() }).where(eq(leadSequenceState.id, state.id))
  }

  // Handle meeting — mark completed
  if (classification.intent === 'meeting') {
    await db.update(leadSequenceState).set({ status: 'completed', updatedAt: new Date() }).where(eq(leadSequenceState.id, state.id))
    await sendFounderAlert(leadId, 'meeting', messageBody, state.tenantId)
  }

  // Load lead for response context
  const [lead] = await db
    .select({ name: leads.name, category: leads.category, city: leads.city, whatsapp: leads.whatsapp })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1)
  if (!lead) return

  // Build conversation history for Ollama context
  const recentLog = await db
    .select({ direction: outreachLog.direction, body: outreachLog.body })
    .from(outreachLog)
    .where(eq(outreachLog.leadId, leadId))
    .orderBy(desc(outreachLog.createdAt))
    .limit(6)
  const history = recentLog.reverse().map(r => `${r.direction === 'outbound' ? 'Us' : 'Them'}: ${(r.body ?? '').slice(0, 200)}`)

  const responseCtx: ResponseContext = {
    leadName: lead.name || 'Компания',
    leadCategory: lead.category,
    leadCity: lead.city,
    inboundMessage: messageBody,
    conversationHistory: history,
    qualificationData: mergedQD,
  }

  let response: Awaited<ReturnType<typeof generateResponse>> = null
  try {
    response = await generateResponse(effectiveIntent, responseCtx)
  } catch (err) {
    console.error(`[sequence-engine] generateResponse failed for lead ${leadId}:`, err instanceof Error ? err.message : err)
  }

  if (response) {
    const phoneDigits = resolvePhoneFromWaPeer(waPeer)
    if (phoneDigits) {
      await whatsappOutreachQueue.add('send', {
        leadId,
        phoneDigits,
        body: response.body,
        tenantId: state.tenantId ?? undefined,
      }, { removeOnComplete: true })
      console.log(`[sequence-engine] Queued auto-response to ${leadId} (${effectiveIntent})`)
    }
  }

  // Send alert to founder for interesting intents
  if (['positive', 'pricing', 'qualification'].includes(effectiveIntent)) {
    await sendFounderAlert(leadId, effectiveIntent, messageBody, state.tenantId)
  }
}

// ── Founder Alerts ───────────────────────────────────────────

async function sendFounderAlert(leadId: string, intent: string, message: string, tenantId?: string | null) {
  const founderPhone = process.env.FOUNDER_WHATSAPP?.replace(/\D/g, '')
  if (!founderPhone) return

  const [lead] = await db
    .select({ name: leads.name, category: leads.category, city: leads.city })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1)

  const icons: Record<string, string> = {
    positive: '🟢', meeting: '📅', pricing: '💰', qualification: '📋', referral: '🔄',
  }

  const body = `${icons[intent] || '📨'} ${lead?.name || 'Unknown'} (${lead?.city || '?'})
Intent: ${intent}
Message: "${message.slice(0, 200)}"

Lead ID: ${leadId}`

  await whatsappOutreachQueue.add('send', {
    phoneDigits: founderPhone,
    body,
    tenantId: tenantId ?? undefined,
  }, { removeOnComplete: true })
}

// ── Sequence Advancement Cron (every 15min) ──────────────────

cron.schedule('*/15 * * * *', async () => {
  try {
    await advanceSequences()
  } catch (err) {
    console.error('[sequence-engine] Error:', err)
  }
})

async function advanceSequences() {
  const now = new Date()

  const readyStates = await db
    .select()
    .from(leadSequenceState)
    .where(and(
      eq(leadSequenceState.status, 'active'),
      sql`${leadSequenceState.nextStepAt} IS NOT NULL AND ${leadSequenceState.nextStepAt} <= ${now}`,
    ))
    .limit(50)

  if (readyStates.length === 0) return
  console.log(`[sequence-engine] ${readyStates.length} sequences ready to advance`)

  const sequences = loadSequences()

  for (const state of readyStates) {
    try {
      const seqDef = sequences[state.sequenceKey]
      if (!seqDef) continue

      const nextIdx = state.currentStep + 1
      const step = seqDef.steps[nextIdx]

      if (!step) {
        await db.update(leadSequenceState).set({ status: 'completed', updatedAt: new Date() }).where(eq(leadSequenceState.id, state.id))
        continue
      }

      if (step.condition === 'no_response' && state.lastReplyAt && state.lastOutreachAt && state.lastReplyAt > state.lastOutreachAt) {
        continue
      }

      const [lead] = await db
        .select({ id: leads.id, name: leads.name, category: leads.category, city: leads.city, whatsapp: leads.whatsapp, email: leads.email })
        .from(leads)
        .where(eq(leads.id, state.leadId))
        .limit(1)
      if (!lead) continue

      const vars = buildVars(lead)
      const body = renderTemplate(step.template, vars)

      if (step.channel === 'whatsapp') {
        let phoneDigits: string | null = null
        if (state.contactId) {
          const [c] = await db.select({ phone: contacts.phone }).from(contacts).where(eq(contacts.id, state.contactId)).limit(1)
          phoneDigits = c?.phone?.replace(/\D/g, '') ?? null
        }
        if (!phoneDigits) {
          const m = (lead.whatsapp ?? '').match(/\d{10,}/)
          phoneDigits = m?.[0] ?? null
        }
        if (!phoneDigits) continue

        await whatsappOutreachQueue.add('send', {
          leadId: state.leadId, phoneDigits, body,
          sequenceKey: state.sequenceKey, stepIndex: nextIdx,
          tenantId: state.tenantId ?? undefined,
        }, { removeOnComplete: true })
      } else if (step.channel === 'email') {
        let emailTo = lead.email?.trim() || null
        if (!emailTo) {
          const rows = await db.select({ email: contacts.email }).from(contacts).where(eq(contacts.leadId, state.leadId)).limit(5)
          emailTo = rows.find(c => c.email?.includes('@'))?.email ?? null
        }
        if (!emailTo) continue

        const subjectMatch = body.match(/^Тема:\s*(.+)$/m)
        const subject = subjectMatch?.[1]?.trim() || `Сотрудничество с ${lead.name || 'вашей компанией'}`
        const emailBody = subjectMatch ? body.replace(/^Тема:\s*.+\n?/m, '').trim() : body

        await emailOutreachQueue.add('send', {
          leadId: state.leadId, to: emailTo, subject, body: emailBody,
          sequenceKey: state.sequenceKey, stepIndex: nextIdx,
          tenantId: state.tenantId ?? undefined,
        }, { removeOnComplete: true })
      }

      const afterNext = seqDef.steps[nextIdx + 1]
      const nextNextAt = afterNext ? new Date(Date.now() + parseDelay(afterNext.delay)) : null

      await db.update(leadSequenceState).set({
        currentStep: nextIdx,
        lastOutreachAt: now,
        nextStepAt: nextNextAt,
        messageCount: sql`${leadSequenceState.messageCount} + 1`,
        updatedAt: now,
      }).where(eq(leadSequenceState.id, state.id))

      console.log(`[sequence-engine] Advanced ${state.leadId} → step ${nextIdx} (${step.channel})`)
    } catch (err) {
      console.error(`[sequence-engine] Error on state ${state.id}:`, err)
    }
  }
}

// ── Start Sequence ───────────────────────────────────────────

export async function startSequence(leadId: string, sequenceKey: string, contactId?: string): Promise<{ stateId: string }> {
  const sequences = loadSequences()
  if (!sequences[sequenceKey]) throw new Error(`Unknown sequence: ${sequenceKey}`)

  const now = new Date()
  const secondStep = sequences[sequenceKey].steps[1]
  const nextStepAt = secondStep ? new Date(now.getTime() + parseDelay(secondStep.delay)) : null

  const [state] = await db
    .insert(leadSequenceState)
    .values({ leadId, contactId: contactId ?? null, sequenceKey, currentStep: 0, status: 'active', intent: 'unknown', startedAt: now, lastOutreachAt: now, nextStepAt })
    .onConflictDoNothing()
    .returning({ id: leadSequenceState.id })

  if (!state) {
    const [existing] = await db
      .select({ id: leadSequenceState.id })
      .from(leadSequenceState)
      .where(and(eq(leadSequenceState.leadId, leadId), eq(leadSequenceState.sequenceKey, sequenceKey), eq(leadSequenceState.status, 'active')))
      .limit(1)
    return { stateId: existing?.id ?? 'already_active' }
  }
  return { stateId: state.id }
}

console.log('[sequence-engine] Sequence engine loaded (cron: */15 * * * *)')

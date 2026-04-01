import { db, leads, outreachLog, leadSequenceState, eq, and, desc } from '@leadiya/db'
import {
  whatsappOutreachQueue,
  type WhatsAppOutreachJobData,
} from '@leadiya/queue'
import {
  classifyReply,
  generateResponse,
  extractQualificationFromMessage,
  type ClassifyResult,
  type ResponseContext,
} from '@leadiya/wa-reply'
import { processReferral } from '../lib/contact-extractor.js'
import { getAutomationLimits, getAutomationMode, shouldSendFounderAlert } from '../lib/worker-business-config.js'
import { logWaAgent } from '../lib/wa-agent-log.js'

const DEFAULT_TENANT_ENV = process.env.DEFAULT_TENANT_ID?.trim() || null
const DEFAULT_HISTORY_MAX_MESSAGES = 20
const DEFAULT_HISTORY_MAX_CHARS = 4000
const MAX_HISTORY_MESSAGE_CHARS = 500

/**
 * Ollama (and any non-keyword path) returns `confidence: 'low'` — see intent-classifier.
 * Escalating on low for `positive` / `pricing` / `qualification` meant real replies often got NO auto-reply.
 * We only escalate low+confidence for intents where automation can do real damage without review.
 *
 * - `OUTREACH_AUTO_REPLY_LOW_CONFIDENCE=1` — never escalate on low confidence.
 * - `=0` / `false` — escalate on meeting/referral/negative even in fully_automatic mode.
 */
function allowLowConfidenceAutoReply(): boolean {
  const v = process.env.OUTREACH_AUTO_REPLY_LOW_CONFIDENCE?.trim()
  if (v === 'true' || v === '1') return true
  if (v === 'false' || v === '0') return false
  return getAutomationMode() === 'fully_automatic'
}

/** Low confidence + these intents → human (wrong meeting/referral/negative is costly). Safe templates still run for positive/pricing/qualification. */
function lowConfidenceBlocksAutoReply(intent: ClassifyResult['intent']): boolean {
  return intent === 'meeting' || intent === 'referral' || intent === 'negative'
}

function hasStrongQualificationSignal(updates: Record<string, unknown>): boolean {
  // `description` alone is too noisy for re-routing (e.g. generic long objections).
  const keys = Object.keys(updates)
  return keys.some((k) => k !== 'description')
}

/** Optional row id from Baileys inbound insert — we stamp `outreach_log.status` with classifier + routing. */
export type InboundReplyMeta = { inboundLogId?: string | null }

async function patchInboundLogStatus(logId: string | null | undefined, status: string): Promise<void> {
  if (!logId) return
  try {
    await db.update(outreachLog).set({ status, updatedAt: new Date() }).where(eq(outreachLog.id, logId))
  } catch (e) {
    console.warn('[inbound-reply] inbound log status patch failed:', e instanceof Error ? e.message : e)
  }
}

function resolveTenantId(explicit?: string | null): string | undefined {
  return explicit ?? DEFAULT_TENANT_ENV ?? undefined
}

function resolvePhoneFromWaPeer(jid: string): string | null {
  const digits = jid.replace(/@.*/, '').replace(/\D/g, '')
  return digits.length >= 10 ? digits : null
}

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const v = raw?.trim()
  const n = v ? Number.parseInt(v, 10) : fallback
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function historyMaxMessages(): number {
  return parsePositiveInt(process.env.OUTREACH_REPLY_HISTORY_MAX_MESSAGES, DEFAULT_HISTORY_MAX_MESSAGES, 1, 50)
}

function historyMaxChars(): number {
  return parsePositiveInt(process.env.OUTREACH_REPLY_HISTORY_MAX_CHARS, DEFAULT_HISTORY_MAX_CHARS, 500, 20000)
}

export function buildConversationHistory(
  rows: Array<{ direction: string; body: string | null }>,
  maxChars: number,
): string[] {
  const lines = rows.map((r) => {
    const speaker = r.direction === 'outbound' ? 'Us' : 'Them'
    return `${speaker}: ${(r.body ?? '').slice(0, MAX_HISTORY_MESSAGE_CHARS)}`
  })

  const keptReversed: string[] = []
  let total = 0
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!
    const next = total + line.length
    if (next > maxChars && keptReversed.length > 0) break
    if (next > maxChars) continue
    keptReversed.push(line)
    total = next
  }
  return keptReversed.reverse()
}

async function loadConversationHistory(leadId: string): Promise<string[]> {
  const recentLog = await db
    .select({ direction: outreachLog.direction, body: outreachLog.body })
    .from(outreachLog)
    .where(eq(outreachLog.leadId, leadId))
    .orderBy(desc(outreachLog.createdAt))
    .limit(historyMaxMessages())

  // DB query is newest-first; responder context reads better oldest->newest.
  const chronological = recentLog.reverse()
  return buildConversationHistory(chronological, historyMaxChars())
}

async function removePendingWaJobsForLead(leadId: string) {
  const types = ['waiting', 'delayed', 'paused'] as const
  let removed = 0
  for (const t of types) {
    const jobs = await whatsappOutreachQueue.getJobs([t], 0, 500, false)
    for (const job of jobs) {
      const d = job.data as WhatsAppOutreachJobData
      if (d.leadId !== leadId) continue
      try {
        await job.remove()
        removed++
      } catch {
        /* race with worker */
      }
    }
  }
  if (removed > 0) {
    console.log(`[inbound-reply] removed ${removed} pending WA job(s) for lead ${leadId} (negative/stop)`)
  }
}

async function tryInboundReplyWithoutActiveSequence(
  leadId: string,
  waPeer: string,
  messageBody: string,
  tenantId?: string | null,
  meta?: InboundReplyMeta,
): Promise<void> {
  const [lead] = await db
    .select({
      name: leads.name,
      category: leads.category,
      city: leads.city,
      whatsapp: leads.whatsapp,
      source: leads.source,
    })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1)
  if (!lead) return

  let classification: ClassifyResult
  try {
    classification = await classifyReply(messageBody)
  } catch (err) {
    console.error(`[inbound-reply] classifyReply failed for lead ${leadId}:`, err instanceof Error ? err.message : err)
    classification = { intent: 'unknown', confidence: 'low' }
  }
  console.log(`[inbound-reply] Lead ${leadId} (no active sequence): intent=${classification.intent} (${classification.confidence})`)

  const newQD = extractQualificationFromMessage(messageBody, {})
  let effectiveIntent = classification.intent
  if (
    hasStrongQualificationSignal(newQD) &&
    (classification.intent === 'positive' || classification.intent === 'question' || classification.intent === 'unknown')
  ) {
    effectiveIntent = 'qualification'
  }

  logWaAgent({
    component: 'inbound-reply',
    action: 'classified',
    leadId,
    tenantId: resolveTenantId(tenantId) ?? undefined,
    intent: effectiveIntent,
    confidence: classification.confidence,
    mode: 'no_sequence',
  })

  await patchInboundLogStatus(
    meta?.inboundLogId,
    `routed:${effectiveIntent}:${classification.confidence}`,
  )

  if (
    classification.confidence === 'low' &&
    !allowLowConfidenceAutoReply() &&
    lowConfidenceBlocksAutoReply(classification.intent)
  ) {
    await patchInboundLogStatus(meta?.inboundLogId, `routed:${effectiveIntent}:${classification.confidence}:hitl`)
    logWaAgent({
      component: 'inbound-reply',
      action: 'skipped',
      reason: 'hitl',
      leadId,
      tenantId: resolveTenantId(tenantId) ?? undefined,
      intent: effectiveIntent,
      confidence: classification.confidence,
      mode: 'no_sequence',
    })
    await sendFounderAlert(leadId, 'escalation', messageBody, resolveTenantId(tenantId))
    console.log(`[inbound-reply] Low confidence — no auto-reply (set OUTREACH_AUTO_REPLY_LOW_CONFIDENCE=1 to override)`)
    return
  }

  if (classification.intent === 'referral' && classification.referralContact?.phone) {
    await processReferral(
      leadId,
      { name: classification.referralContact.name, phone: classification.referralContact.phone },
      'cold_outreach',
    )
  }

  const history = await loadConversationHistory(leadId)

  const responseCtx: ResponseContext = {
    leadName: lead.name || 'Компания',
    leadCategory: lead.category,
    leadCity: lead.city,
    inboundMessage: messageBody,
    conversationHistory: history,
    qualificationData: newQD,
  }

  let response: Awaited<ReturnType<typeof generateResponse>> = null
  try {
    response = await generateResponse(effectiveIntent, responseCtx)
  } catch (err) {
    console.error(`[inbound-reply] generateResponse (no-sequence) failed for ${leadId}:`, err instanceof Error ? err.message : err)
  }

  if (response) {
    const phoneDigits = resolvePhoneFromWaPeer(waPeer)
    if (phoneDigits) {
      const job = await whatsappOutreachQueue.add(
        'send',
        {
          leadId,
          phoneDigits,
          body: response.body,
          tenantId: resolveTenantId(tenantId),
        },
        { removeOnComplete: true },
      )
      logWaAgent({
        component: 'inbound-reply',
        action: 'queued',
        jobId: job.id,
        leadId,
        tenantId: resolveTenantId(tenantId) ?? undefined,
        intent: effectiveIntent,
        confidence: classification.confidence,
        mode: 'no_sequence',
      })
      await patchInboundLogStatus(
        meta?.inboundLogId,
        `routed:${effectiveIntent}:${classification.confidence}:replied`,
      )
      console.log(`[inbound-reply] Queued no-sequence auto-response to ${leadId} (${effectiveIntent})`)
    } else {
      await patchInboundLogStatus(
        meta?.inboundLogId,
        `routed:${effectiveIntent}:${classification.confidence}:no_wa_digits`,
      )
    }
  } else {
    await patchInboundLogStatus(
      meta?.inboundLogId,
      `routed:${effectiveIntent}:${classification.confidence}:no_reply_body`,
    )
  }

  if (['positive', 'pricing', 'qualification'].includes(effectiveIntent)) {
    await sendFounderAlert(leadId, effectiveIntent, messageBody, resolveTenantId(tenantId))
  }
}

export async function handleInboundReply(
  leadId: string | null,
  waPeer: string,
  messageBody: string,
  tenantId?: string | null,
  meta?: InboundReplyMeta,
) {
  if (!leadId) return

  const [state] = await db
    .select()
    .from(leadSequenceState)
    .where(and(eq(leadSequenceState.leadId, leadId), eq(leadSequenceState.status, 'active')))
    .limit(1)

  if (!state) {
    await tryInboundReplyWithoutActiveSequence(leadId, waPeer, messageBody, tenantId, meta)
    return
  }

  let classification: ClassifyResult
  try {
    classification = await classifyReply(messageBody)
  } catch (err) {
    console.error(`[inbound-reply] classifyReply failed for lead ${leadId}:`, err instanceof Error ? err.message : err)
    classification = { intent: 'unknown', confidence: 'low' }
  }
  console.log(`[inbound-reply] Lead ${leadId}: intent=${classification.intent} (${classification.confidence})`)

  const currentQD = (state.qualificationData ?? {}) as Record<string, unknown>
  const newQD = extractQualificationFromMessage(messageBody, currentQD)
  const mergedQD = { ...currentQD, ...newQD }

  let effectiveIntent = classification.intent
  if (
    hasStrongQualificationSignal(newQD) &&
    (classification.intent === 'positive' || classification.intent === 'question' || classification.intent === 'unknown')
  ) {
    effectiveIntent = 'qualification'
  }

  await patchInboundLogStatus(
    meta?.inboundLogId,
    `routed:${effectiveIntent}:${classification.confidence}:sequence`,
  )

  logWaAgent({
    component: 'inbound-reply',
    action: 'classified',
    leadId,
    tenantId: resolveTenantId(tenantId ?? state.tenantId) ?? undefined,
    intent: effectiveIntent,
    confidence: classification.confidence,
    mode: 'sequence',
  })

  if (
    classification.confidence === 'low' &&
    !allowLowConfidenceAutoReply() &&
    lowConfidenceBlocksAutoReply(classification.intent)
  ) {
    await patchInboundLogStatus(
      meta?.inboundLogId,
      `routed:${effectiveIntent}:${classification.confidence}:sequence:hitl`,
    )
    logWaAgent({
      component: 'inbound-reply',
      action: 'skipped',
      reason: 'hitl',
      leadId,
      tenantId: resolveTenantId(tenantId ?? state.tenantId) ?? undefined,
      intent: effectiveIntent,
      confidence: classification.confidence,
      mode: 'sequence',
    })
    await db
      .update(leadSequenceState)
      .set({
        intent: classification.intent,
        lastReplyAt: new Date(),
        qualificationData: state.qualificationData,
        updatedAt: new Date(),
      })
      .where(eq(leadSequenceState.id, state.id))
    await sendFounderAlert(leadId, 'escalation', messageBody, resolveTenantId(tenantId ?? state.tenantId))
    console.log(`[inbound-reply] Low confidence — escalated, no auto-reply`)
    return
  }

  await db
    .update(leadSequenceState)
    .set({
      intent: effectiveIntent,
      lastReplyAt: new Date(),
      qualificationData: mergedQD,
      updatedAt: new Date(),
    })
    .where(eq(leadSequenceState.id, state.id))

  if (classification.intent === 'referral' && classification.referralContact?.phone) {
    await processReferral(leadId, { name: classification.referralContact.name, phone: classification.referralContact.phone }, state.sequenceKey)
  }

  if (classification.intent === 'negative') {
    await patchInboundLogStatus(
      meta?.inboundLogId,
      `routed:${effectiveIntent}:${classification.confidence}:sequence:negative`,
    )
    const { defaultCooldownMs } = getAutomationLimits()
    await db.update(leadSequenceState).set({ status: 'cold', updatedAt: new Date() }).where(eq(leadSequenceState.id, state.id))
    await db
      .update(leads)
      .set({
        nextOutreachEligibleAt: new Date(Date.now() + defaultCooldownMs),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId))
    await removePendingWaJobsForLead(leadId)
    logWaAgent({
      component: 'inbound-reply',
      action: 'skipped',
      reason: 'negative_stop',
      leadId,
      tenantId: resolveTenantId(tenantId ?? state.tenantId) ?? undefined,
      intent: effectiveIntent,
      confidence: classification.confidence,
      mode: 'sequence',
    })
    console.log(`[inbound-reply] Lead ${leadId} marked cold — no auto-reply sent`)
    return
  }

  if (classification.intent === 'meeting') {
    await patchInboundLogStatus(
      meta?.inboundLogId,
      `routed:${effectiveIntent}:${classification.confidence}:sequence:meeting`,
    )
    const { defaultCooldownMs } = getAutomationLimits()
    await db.update(leadSequenceState).set({ status: 'completed', updatedAt: new Date() }).where(eq(leadSequenceState.id, state.id))
    await db
      .update(leads)
      .set({
        nextOutreachEligibleAt: new Date(Date.now() + defaultCooldownMs),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId))
    await sendFounderAlert(leadId, 'meeting', messageBody, resolveTenantId(tenantId ?? state.tenantId))
    logWaAgent({
      component: 'inbound-reply',
      action: 'skipped',
      reason: 'meeting_handoff',
      leadId,
      tenantId: resolveTenantId(tenantId ?? state.tenantId) ?? undefined,
      intent: effectiveIntent,
      confidence: classification.confidence,
      mode: 'sequence',
    })
    console.log(`[inbound-reply] Lead ${leadId} meeting confirmed — no auto-reply sent`)
    return
  }

  const [lead] = await db
    .select({ name: leads.name, category: leads.category, city: leads.city, whatsapp: leads.whatsapp })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1)
  if (!lead) return

  const history = await loadConversationHistory(leadId)

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
    console.error(`[inbound-reply] generateResponse failed for lead ${leadId}:`, err instanceof Error ? err.message : err)
  }

  if (response) {
    const phoneDigits = resolvePhoneFromWaPeer(waPeer)
    if (phoneDigits) {
      const job = await whatsappOutreachQueue.add('send', {
        leadId,
        phoneDigits,
        body: response.body,
        tenantId: resolveTenantId(tenantId ?? state.tenantId),
      }, { removeOnComplete: true })
      logWaAgent({
        component: 'inbound-reply',
        action: 'queued',
        jobId: job.id,
        leadId,
        tenantId: resolveTenantId(tenantId ?? state.tenantId) ?? undefined,
        intent: effectiveIntent,
        confidence: classification.confidence,
        mode: 'sequence',
      })
      await patchInboundLogStatus(
        meta?.inboundLogId,
        `routed:${effectiveIntent}:${classification.confidence}:sequence:replied`,
      )
      console.log(`[inbound-reply] Queued auto-response to ${leadId} (${effectiveIntent})`)
    } else {
      await patchInboundLogStatus(
        meta?.inboundLogId,
        `routed:${effectiveIntent}:${classification.confidence}:sequence:no_wa_digits`,
      )
    }
  } else {
    await patchInboundLogStatus(
      meta?.inboundLogId,
      `routed:${effectiveIntent}:${classification.confidence}:sequence:no_reply_body`,
    )
  }

  if (['positive', 'pricing', 'qualification'].includes(effectiveIntent)) {
    await sendFounderAlert(leadId, effectiveIntent, messageBody, resolveTenantId(tenantId ?? state.tenantId))
  }
}

async function sendFounderAlert(leadId: string, intent: string, message: string, tenantId?: string | null) {
  if (!shouldSendFounderAlert(intent)) return
  const founderPhone = process.env.FOUNDER_WHATSAPP?.replace(/\D/g, '')
  if (!founderPhone) return

  const [lead] = await db
    .select({ name: leads.name, category: leads.category, city: leads.city })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1)

  const icons: Record<string, string> = {
    positive: '🟢',
    meeting: '📅',
    pricing: '💰',
    qualification: '📋',
    referral: '🔄',
    escalation: '⚠️',
  }

  const body = `${icons[intent] || '📨'} ${lead?.name || 'Unknown'} (${lead?.city || '?'})
Intent: ${intent}
Message: "${message.slice(0, 200)}"

Lead ID: ${leadId}`

  await whatsappOutreachQueue.add(
    'send',
    {
      phoneDigits: founderPhone,
      body,
      tenantId: tenantId ?? undefined,
      outreachLogStatus: 'internal_alert',
    },
    { removeOnComplete: true },
  )
}

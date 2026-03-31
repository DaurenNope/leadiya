import { db, leads, outreachLog, leadSequenceState, eq, sql, and, desc } from '@leadiya/db'
import {
  whatsappOutreachQueue,
  type WhatsAppOutreachJobData,
} from '@leadiya/queue'
import { classifyReply, type ClassifyResult } from '../lib/intent-classifier.js'
import { generateResponse, extractQualificationFromMessage, type ResponseContext } from '../lib/auto-responder.js'
import { processReferral } from '../lib/contact-extractor.js'
import { getAutomationLimits } from '../lib/worker-business-config.js'

const DEFAULT_TENANT_ENV = process.env.DEFAULT_TENANT_ID?.trim() || null
const MAX_AUTO_REPLIES = 5
const AUTO_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** When false (default), low-confidence classification does not auto-queue a reply — founder alert only (HITL). */
function allowLowConfidenceAutoReply(): boolean {
  const v = process.env.OUTREACH_AUTO_REPLY_LOW_CONFIDENCE?.trim()
  return v === 'true' || v === '1'
}

function resolveTenantId(explicit?: string | null): string | undefined {
  return explicit ?? DEFAULT_TENANT_ENV ?? undefined
}

function resolvePhoneFromWaPeer(jid: string): string | null {
  const digits = jid.replace(/@.*/, '').replace(/\D/g, '')
  return digits.length >= 10 ? digits : null
}

async function countRecentAutoReplies(leadId: string): Promise<number> {
  const since = new Date(Date.now() - AUTO_REPLY_WINDOW_MS)
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outreachLog)
    .where(
      and(
        eq(outreachLog.leadId, leadId),
        eq(outreachLog.channel, 'whatsapp'),
        eq(outreachLog.direction, 'outbound'),
        sql`${outreachLog.createdAt} >= ${since}`,
      ),
    )
  return rows[0]?.count ?? 0
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

  const [priorOutbound] = await db
    .select({ id: outreachLog.id })
    .from(outreachLog)
    .where(
      and(
        eq(outreachLog.leadId, leadId),
        eq(outreachLog.channel, 'whatsapp'),
        eq(outreachLog.direction, 'outbound'),
      ),
    )
    .limit(1)

  if (!priorOutbound && lead.source !== 'whatsapp_inbound') {
    console.log(
      `[inbound-reply] Inbound for ${leadId} ignored: no prior WA outbound and not WhatsApp-first lead (source=${lead.source ?? 'null'}).`,
    )
    return
  }

  let classification: ClassifyResult
  try {
    classification = await classifyReply(messageBody)
  } catch (err) {
    console.error(`[inbound-reply] classifyReply failed for lead ${leadId}:`, err instanceof Error ? err.message : err)
    classification = { intent: 'unknown', confidence: 'low' }
  }
  console.log(`[inbound-reply] Lead ${leadId} (no active sequence): intent=${classification.intent} (${classification.confidence})`)

  if (classification.confidence === 'low' && !allowLowConfidenceAutoReply()) {
    await sendFounderAlert(leadId, 'escalation', messageBody, resolveTenantId(tenantId))
    console.log(`[inbound-reply] Low confidence — no auto-reply (set OUTREACH_AUTO_REPLY_LOW_CONFIDENCE=1 to override)`)
    return
  }

  const newQD = extractQualificationFromMessage(messageBody, {})
  let effectiveIntent = classification.intent
  if (
    Object.keys(newQD).length > 0 &&
    (classification.intent === 'positive' || classification.intent === 'question' || classification.intent === 'unknown')
  ) {
    effectiveIntent = 'qualification'
  }

  if (classification.intent === 'referral' && classification.referralContact?.phone) {
    await processReferral(
      leadId,
      { name: classification.referralContact.name, phone: classification.referralContact.phone },
      'cold_outreach',
    )
  }

  const autoReplyCount = await countRecentAutoReplies(leadId)
  if (autoReplyCount >= MAX_AUTO_REPLIES) {
    await sendFounderAlert(leadId, 'max_turns', messageBody, resolveTenantId(tenantId))
    console.log(`[inbound-reply] Max auto-replies (${MAX_AUTO_REPLIES}) reached for ${leadId} — escalating to human`)
    return
  }

  const recentLog = await db
    .select({ direction: outreachLog.direction, body: outreachLog.body })
    .from(outreachLog)
    .where(eq(outreachLog.leadId, leadId))
    .orderBy(desc(outreachLog.createdAt))
    .limit(6)
  const history = recentLog.reverse().map((r) => `${r.direction === 'outbound' ? 'Us' : 'Them'}: ${(r.body ?? '').slice(0, 200)}`)

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
      await whatsappOutreachQueue.add(
        'send',
        {
          leadId,
          phoneDigits,
          body: response.body,
          tenantId: resolveTenantId(tenantId),
        },
        { removeOnComplete: true },
      )
      console.log(`[inbound-reply] Queued no-sequence auto-response to ${leadId} (${effectiveIntent})`)
    }
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
) {
  if (!leadId) return

  const [state] = await db
    .select()
    .from(leadSequenceState)
    .where(and(eq(leadSequenceState.leadId, leadId), eq(leadSequenceState.status, 'active')))
    .limit(1)

  if (!state) {
    await tryInboundReplyWithoutActiveSequence(leadId, waPeer, messageBody, tenantId)
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

  if (classification.confidence === 'low' && !allowLowConfidenceAutoReply()) {
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

  const currentQD = (state.qualificationData ?? {}) as Record<string, unknown>
  const newQD = extractQualificationFromMessage(messageBody, currentQD)
  const mergedQD = { ...currentQD, ...newQD }

  let effectiveIntent = classification.intent
  if (Object.keys(newQD).length > 0 && (classification.intent === 'positive' || classification.intent === 'question' || classification.intent === 'unknown')) {
    effectiveIntent = 'qualification'
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
    console.log(`[inbound-reply] Lead ${leadId} marked cold — no auto-reply sent`)
    return
  }

  if (classification.intent === 'meeting') {
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
    console.log(`[inbound-reply] Lead ${leadId} meeting confirmed — no auto-reply sent`)
    return
  }

  const [lead] = await db
    .select({ name: leads.name, category: leads.category, city: leads.city, whatsapp: leads.whatsapp })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1)
  if (!lead) return

  const autoReplyCount = await countRecentAutoReplies(leadId)
  if (autoReplyCount >= MAX_AUTO_REPLIES) {
    await sendFounderAlert(leadId, 'max_turns', messageBody, resolveTenantId(tenantId ?? state.tenantId))
    console.log(`[inbound-reply] Max auto-replies (${MAX_AUTO_REPLIES}) reached for ${leadId} — escalating to human`)
    return
  }

  const recentLog = await db
    .select({ direction: outreachLog.direction, body: outreachLog.body })
    .from(outreachLog)
    .where(eq(outreachLog.leadId, leadId))
    .orderBy(desc(outreachLog.createdAt))
    .limit(6)
  const history = recentLog.reverse().map((r) => `${r.direction === 'outbound' ? 'Us' : 'Them'}: ${(r.body ?? '').slice(0, 200)}`)

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
      await whatsappOutreachQueue.add('send', {
        leadId,
        phoneDigits,
        body: response.body,
        tenantId: resolveTenantId(tenantId ?? state.tenantId),
      }, { removeOnComplete: true })
      console.log(`[inbound-reply] Queued auto-response to ${leadId} (${effectiveIntent})`)
    }
  }

  if (['positive', 'pricing', 'qualification'].includes(effectiveIntent)) {
    await sendFounderAlert(leadId, effectiveIntent, messageBody, state.tenantId)
  }
}

async function sendFounderAlert(leadId: string, intent: string, message: string, tenantId?: string | null) {
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
    max_turns: '🛑',
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

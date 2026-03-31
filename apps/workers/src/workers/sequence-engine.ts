import cron from 'node-cron'
import { db, leads, contacts, leadSequenceState, eq, sql, and } from '@leadiya/db'
import { whatsappOutreachQueue, emailOutreachQueue } from '@leadiya/queue'
export { handleInboundReply } from './inbound-reply.js'
import { withCronLock } from '../lib/cron-lock.js'
import { getOutreachTemplateDefaults } from '../lib/worker-business-config.js'
import { getMergedSequencesForTenant } from '../lib/merged-sequences.js'

interface SequenceStep {
  id: string
  delay?: string | number
  channel: 'whatsapp' | 'email'
  condition?: string
  template: string
}

interface SequenceDef {
  trigger: string
  cooldown?: string
  steps: SequenceStep[]
}

const DEFAULT_TENANT_ENV = process.env.DEFAULT_TENANT_ID?.trim() || null

function parseDelay(delay: string | number | undefined): number {
  if (delay == null) return 0
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
  const d = getOutreachTemplateDefaults()
  return {
    company: lead.name?.trim() || 'Компания',
    first_name: d.default_first_name,
    industry: lead.category?.trim() || 'вашей отрасли',
    city: lead.city?.trim() || '',
    calendar_url: d.calendar_url,
    signature: d.signature,
    our_name: d.our_name,
  }
}

// ── Sequence Advancement Cron (every 15min) ──────────────────

cron.schedule('*/15 * * * *', async () => {
  await withCronLock('sequence-advance', 840, async () => {
    try {
      await advanceSequences()
    } catch (err) {
      console.error('[sequence-engine] Error:', err)
    }
  })
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

  const tenantIds = [
    ...new Set(
      readyStates.map((s) => s.tenantId ?? DEFAULT_TENANT_ENV ?? null),
    ),
  ]
  const mergedByTenant = new Map<string | null, Record<string, SequenceDef>>()
  for (const tid of tenantIds) {
    mergedByTenant.set(tid, (await getMergedSequencesForTenant(tid)) as Record<string, SequenceDef>)
  }

  for (const state of readyStates) {
    try {
      const tid = state.tenantId ?? DEFAULT_TENANT_ENV ?? null
      const sequences =
        mergedByTenant.get(tid) ?? ((await getMergedSequencesForTenant(null)) as Record<string, SequenceDef>)
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

export async function startSequence(
  leadId: string,
  sequenceKey: string,
  contactId?: string,
  tenantId?: string | null,
): Promise<{ stateId: string }> {
  const sequences = (await getMergedSequencesForTenant(tenantId ?? DEFAULT_TENANT_ENV ?? null)) as Record<
    string,
    SequenceDef
  >
  if (!sequences[sequenceKey]) throw new Error(`Unknown sequence: ${sequenceKey}`)

  const now = new Date()
  const secondStep = sequences[sequenceKey].steps[1]
  const nextStepAt = secondStep ? new Date(now.getTime() + parseDelay(secondStep.delay)) : null

  const [state] = await db
    .insert(leadSequenceState)
    .values({
      tenantId: tenantId ?? DEFAULT_TENANT_ENV ?? null,
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

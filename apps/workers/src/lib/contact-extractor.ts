import { db, contacts, leads, leadSequenceState, eq, sql } from '@leadiya/db'

interface ReferralInfo {
  name?: string
  phone: string
}

export async function processReferral(
  leadId: string,
  referral: ReferralInfo,
  sourceSequenceKey: string,
): Promise<{ contactId: string; newSequenceStarted: boolean }> {
  const digits = normalizePhone(referral.phone)
  if (!digits) throw new Error(`Invalid referral phone: ${referral.phone}`)

  const existing = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(sql`${contacts.leadId} = ${leadId} AND ${contacts.phone} = ${digits}`)
    .limit(1)

  let contactId: string
  if (existing.length > 0) {
    contactId = existing[0].id
  } else {
    const [newContact] = await db
      .insert(contacts)
      .values({
        leadId,
        fullName: referral.name ?? null,
        phone: digits,
        role: 'referred',
        source: 'referral',
        isPrimary: false,
      })
      .returning({ id: contacts.id })
    contactId = newContact.id
  }

  const [lead] = await db.select({ whatsapp: leads.whatsapp }).from(leads).where(eq(leads.id, leadId)).limit(1)
  if (!lead?.whatsapp || lead.whatsapp === 'https://www.whatsapp.com/') {
    await db.update(leads).set({ whatsapp: `https://wa.me/${digits}`, updatedAt: new Date() }).where(eq(leads.id, leadId))
  }

  await db
    .update(leadSequenceState)
    .set({ status: 'referred', intent: 'referral', updatedAt: new Date() })
    .where(sql`${leadSequenceState.leadId} = ${leadId} AND ${leadSequenceState.sequenceKey} = ${sourceSequenceKey} AND ${leadSequenceState.status} = 'active'`)

  const now = new Date()
  await db.insert(leadSequenceState).values({
    leadId,
    contactId,
    sequenceKey: sourceSequenceKey,
    currentStep: 0,
    status: 'active',
    intent: 'unknown',
    startedAt: now,
    nextStepAt: now,
  })

  return { contactId, newSequenceStarted: true }
}

function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, '')
  if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1)
  if (d.length === 10 && !d.startsWith('7')) d = '7' + d
  if (d.length === 11 && d.startsWith('7')) return d
  return d.length >= 10 ? d : null
}

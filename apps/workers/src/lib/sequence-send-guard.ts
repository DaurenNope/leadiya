import { db, leadSequenceState, eq, and, desc } from '@leadiya/db'

export async function shouldSuppressSequenceSend(leadId?: string, sequenceKey?: string): Promise<boolean> {
  if (!leadId || !sequenceKey) return false
  const [latest] = await db
    .select({ status: leadSequenceState.status })
    .from(leadSequenceState)
    .where(and(eq(leadSequenceState.leadId, leadId), eq(leadSequenceState.sequenceKey, sequenceKey)))
    .orderBy(desc(leadSequenceState.updatedAt))
    .limit(1)
  return Boolean(latest && latest.status !== 'active')
}

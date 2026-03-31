import {
  db,
  outreachSequenceDefs,
  eq,
  mergeOutreachSequenceDefinitions,
  type OutreachSequenceDef,
} from '@leadiya/db'
import { loadOutreachSequences, type SequenceDef, clearSequencesCache } from './outreach-config.js'

export { clearSequencesCache }

export async function getMergedSequencesForTenant(tenantId: string | null): Promise<Record<string, SequenceDef>> {
  const defaults = loadOutreachSequences()
  if (!tenantId) return defaults

  const rows = await db
    .select({
      sequenceKey: outreachSequenceDefs.sequenceKey,
      definition: outreachSequenceDefs.definition,
    })
    .from(outreachSequenceDefs)
    .where(eq(outreachSequenceDefs.tenantId, tenantId))

  const merged = mergeOutreachSequenceDefinitions(
    defaults as Record<string, OutreachSequenceDef>,
    rows.map((r) => ({
      sequenceKey: r.sequenceKey,
      definition: r.definition as OutreachSequenceDef,
    })),
  )
  return merged as Record<string, SequenceDef>
}

export function bustSequenceCachesAfterDbWrite(): void {
  clearSequencesCache()
}

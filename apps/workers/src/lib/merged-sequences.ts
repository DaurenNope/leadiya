import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { db, outreachSequenceDefs, eq, mergeOutreachSequenceDefinitions, type OutreachSequenceDef } from '@leadiya/db'

interface SequenceStep {
  id: string
  delay?: string | number
  channel: string
  condition?: string
  template: string
}

interface SequenceDef {
  trigger: string
  steps: SequenceStep[]
}

let fileCache: Record<string, SequenceDef> | null = null

function loadSequencesFromDisk(): Record<string, SequenceDef> {
  if (fileCache) return fileCache
  const raw = readFileSync(join(process.cwd(), 'config', 'sequences.yml'), 'utf8')
  const doc = parseYaml(raw) as { sequences?: Record<string, SequenceDef> }
  fileCache = doc.sequences ?? {}
  return fileCache
}

/** Same merge semantics as API: YAML defaults + per-tenant `outreach_sequence_defs` rows. */
export async function getMergedSequencesForTenant(
  tenantId: string | null | undefined,
): Promise<Record<string, SequenceDef>> {
  const defaults = loadSequencesFromDisk()
  if (!tenantId) return defaults

  const rows = await db
    .select({
      sequenceKey: outreachSequenceDefs.sequenceKey,
      definition: outreachSequenceDefs.definition,
    })
    .from(outreachSequenceDefs)
    .where(eq(outreachSequenceDefs.tenantId, tenantId))

  return mergeOutreachSequenceDefinitions(
    defaults as Record<string, OutreachSequenceDef>,
    rows.map((r) => ({
      sequenceKey: r.sequenceKey,
      definition: r.definition as OutreachSequenceDef,
    })),
  ) as Record<string, SequenceDef>
}

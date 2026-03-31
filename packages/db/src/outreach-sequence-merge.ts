/**
 * Pure merge: YAML defaults + per-tenant DB rows (full sequence replacement per key).
 * Shape matches `apps/api/src/lib/outreach-config.ts` SequenceDef.
 */
export type OutreachSequenceStep = {
  id: string
  channel: string
  delay?: string | number
  condition?: string
  template: string
}

export type OutreachSequenceDef = {
  trigger: string
  steps: OutreachSequenceStep[]
}

export function mergeOutreachSequenceDefinitions(
  defaults: Record<string, OutreachSequenceDef>,
  overrides: { sequenceKey: string; definition: OutreachSequenceDef }[],
): Record<string, OutreachSequenceDef> {
  const out: Record<string, OutreachSequenceDef> = { ...defaults }
  for (const o of overrides) {
    out[o.sequenceKey] = o.definition
  }
  return out
}

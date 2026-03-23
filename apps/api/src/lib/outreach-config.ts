import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const configDir = join(dirname(fileURLToPath(import.meta.url)), '../../config')

export type SequenceStep = {
  id: string
  delay?: string | number
  channel: string
  condition?: string
  template: string
}

export type SequenceDef = {
  trigger: string
  steps: SequenceStep[]
}

let sequencesCache: Record<string, SequenceDef> | null = null
let businessCache: Record<string, unknown> | null = null

export function loadOutreachSequences(): Record<string, SequenceDef> {
  if (sequencesCache) return sequencesCache
  const raw = readFileSync(join(configDir, 'sequences.yml'), 'utf8')
  const doc = parse(raw) as { sequences?: Record<string, SequenceDef> }
  sequencesCache = doc.sequences ?? {}
  return sequencesCache
}

export function loadBusinessConfig(): Record<string, unknown> {
  if (businessCache) return businessCache
  const raw = readFileSync(join(configDir, 'business.yml'), 'utf8')
  businessCache = parse(raw) as Record<string, unknown>
  return businessCache
}

export function listSequenceSummaries() {
  const sequences = loadOutreachSequences()
  return Object.entries(sequences).map(([key, seq]) => ({
    key,
    trigger: seq.trigger,
    steps: seq.steps.map((s) => ({ id: s.id, channel: s.channel, delay: s.delay })),
  }))
}

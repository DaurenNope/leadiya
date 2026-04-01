import type { DeadLetterLead, QueuedLead, SinkId } from '../lead-types'

const DEAD_LETTERS_KEY = 'deadLettersV1'
const DEAD_LETTER_LIMIT = 500

export async function loadDeadLetters(): Promise<DeadLetterLead[]> {
  const r = await chrome.storage.local.get(DEAD_LETTERS_KEY)
  const list = r[DEAD_LETTERS_KEY]
  return Array.isArray(list) ? (list as DeadLetterLead[]) : []
}

export async function clearDeadLetters(): Promise<void> {
  await chrome.storage.local.set({ [DEAD_LETTERS_KEY]: [] })
}

export async function pushDeadLetterFromQueue(
  queued: QueuedLead,
  sink: SinkId,
  reason: string
): Promise<void> {
  const existing = await loadDeadLetters()
  existing.unshift({
    id: queued.id,
    sink,
    reason,
    failedAt: new Date().toISOString(),
    lead: queued.lead,
  })
  if (existing.length > DEAD_LETTER_LIMIT) {
    existing.length = DEAD_LETTER_LIMIT
  }
  await chrome.storage.local.set({ [DEAD_LETTERS_KEY]: existing })
}


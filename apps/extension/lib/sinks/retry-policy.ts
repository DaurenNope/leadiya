import type { SinkId } from '../lead-types'

const MAX_RETRIES: Record<SinkId, number> = {
  api: 5,
  webhook: 6,
  sheets: 4,
}

const BASE_DELAY_MS: Record<SinkId, number> = {
  api: 1_500,
  webhook: 2_000,
  sheets: 2_500,
}

export function maxRetriesForSink(sink: SinkId): number {
  return MAX_RETRIES[sink]
}

export function nextBackoffMs(sink: SinkId, attempts: number): number {
  const base = BASE_DELAY_MS[sink]
  const exp = Math.min(6, Math.max(0, attempts - 1))
  const jitter = Math.floor(Math.random() * 300)
  return base * 2 ** exp + jitter
}


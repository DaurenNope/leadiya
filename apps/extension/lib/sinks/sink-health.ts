import type { QueuedLead, SinkId } from '../lead-types'

export type SinkHealthStatus = 'idle' | 'ok' | 'error'

export type SinkHealth = Record<
  SinkId,
  {
    status: SinkHealthStatus
    lastMessage: string
    lastAt: string | null
    retryPending: number
    lastSent?: number
    lastInserted?: number
    lastDuplicate?: number
    lastRejected?: number
  }
>

export function defaultSinkHealth(): SinkHealth {
  return {
    api: { status: 'idle', lastMessage: '', lastAt: null, retryPending: 0 },
    webhook: { status: 'idle', lastMessage: '', lastAt: null, retryPending: 0 },
    sheets: { status: 'idle', lastMessage: '', lastAt: null, retryPending: 0 },
  }
}

export function sinkFromEventMessage(message: string): SinkId | null {
  if (message.startsWith('API:')) return 'api'
  if (message.startsWith('Webhook:')) return 'webhook'
  if (message.startsWith('Sheets:')) return 'sheets'
  return null
}

export function applySinkEvent(
  health: SinkHealth,
  level: 'info' | 'warn' | 'error',
  message: string,
  atIso = new Date().toISOString()
): SinkHealth {
  const sink = sinkFromEventMessage(message)
  if (!sink) return health
  const next = { ...health[sink] }
  const countMatch = message.match(/(\d+)/g)
  if (sink === 'api') {
    const inserted = message.match(/inserted=(\d+)/)?.[1]
    const duplicate = message.match(/duplicate=(\d+)/)?.[1]
    const rejected = message.match(/rejected=(\d+)/)?.[1]
    if (inserted) next.lastInserted = Number(inserted)
    if (duplicate) next.lastDuplicate = Number(duplicate)
    if (rejected) next.lastRejected = Number(rejected)
  } else if (countMatch?.[0]) {
    next.lastSent = Number(countMatch[0])
  }
  return {
    ...health,
    [sink]: {
      ...next,
      status: level === 'error' ? 'error' : 'ok',
      lastMessage: message,
      lastAt: atIso,
    },
  }
}

export function withRetryPending(health: SinkHealth, queue: QueuedLead[], nowMs = Date.now()): SinkHealth {
  const counts: Record<SinkId, number> = { api: 0, webhook: 0, sheets: 0 }
  for (const q of queue) {
    for (const sink of ['api', 'webhook', 'sheets'] as const) {
      if (q.delivered[sink]) continue
      const next = q.deliveryMeta?.[sink]?.nextEligibleAt
      if (next && next > nowMs) counts[sink] += 1
    }
  }
  return {
    api: { ...health.api, retryPending: counts.api },
    webhook: { ...health.webhook, retryPending: counts.webhook },
    sheets: { ...health.sheets, retryPending: counts.sheets },
  }
}


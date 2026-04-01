import { describe, expect, it } from 'vitest'
import { applySinkEvent, defaultSinkHealth, sinkFromEventMessage, withRetryPending } from '../lib/sinks/sink-health'
import type { QueuedLead } from '../lib/lead-types'

describe('sink-health helpers', () => {
  it('maps known sink prefixes', () => {
    expect(sinkFromEventMessage('API: отправлено 2')).toBe('api')
    expect(sinkFromEventMessage('Webhook: timeout')).toBe('webhook')
    expect(sinkFromEventMessage('Sheets: 401')).toBe('sheets')
    expect(sinkFromEventMessage('Bulk: done')).toBe(null)
  })

  it('updates status from event level', () => {
    const h0 = defaultSinkHealth()
    const h1 = applySinkEvent(h0, 'info', 'API: inserted=1 duplicate=2 rejected=3', '2026-01-01T00:00:00.000Z')
    expect(h1.api.status).toBe('ok')
    expect(h1.api.lastAt).toBe('2026-01-01T00:00:00.000Z')
    expect(h1.api.lastInserted).toBe(1)
    expect(h1.api.lastDuplicate).toBe(2)
    expect(h1.api.lastRejected).toBe(3)
    expect(h1.api.history.length).toBe(1)
    const h2 = applySinkEvent(h1, 'error', 'API: timeout', '2026-01-01T00:00:01.000Z')
    expect(h2.api.status).toBe('error')
    expect(h2.api.lastMessage).toContain('timeout')
    expect(h2.api.history.length).toBe(2)
    expect(h2.api.history[0]?.level).toBe('error')
  })

  it('stores sent count for non-api sinks', () => {
    const h0 = defaultSinkHealth()
    const h1 = applySinkEvent(h0, 'info', 'Webhook: отправлено 12', '2026-01-01T00:00:00.000Z')
    expect(h1.webhook.lastSent).toBe(12)
    const h2 = applySinkEvent(h1, 'info', 'Sheets: добавлено 7 строк', '2026-01-01T00:00:00.000Z')
    expect(h2.sheets.lastSent).toBe(7)
  })

  it('counts retry-pending queue items by sink', () => {
    const queue: QueuedLead[] = [
      {
        id: '1',
        lead: {} as any,
        delivered: {},
        deliveryMeta: { api: { attempts: 1, nextEligibleAt: 9999 } },
      },
      {
        id: '2',
        lead: {} as any,
        delivered: {},
        deliveryMeta: { webhook: { attempts: 2, nextEligibleAt: 9999 } },
      },
      {
        id: '3',
        lead: {} as any,
        delivered: { sheets: true },
        deliveryMeta: { sheets: { attempts: 1, nextEligibleAt: 9999 } },
      },
    ]
    const h = withRetryPending(defaultSinkHealth(), queue, 1000)
    expect(h.api.retryPending).toBe(1)
    expect(h.webhook.retryPending).toBe(1)
    expect(h.sheets.retryPending).toBe(0)
  })

  it('keeps only the latest 5 history entries', () => {
    let h = defaultSinkHealth()
    for (let i = 0; i < 8; i++) {
      h = applySinkEvent(h, 'info', `API: inserted=${i} duplicate=0 rejected=0`, `2026-01-01T00:00:0${i}.000Z`)
    }
    expect(h.api.history.length).toBe(5)
    expect(h.api.history[0]?.message).toContain('inserted=7')
    expect(h.api.history[4]?.message).toContain('inserted=3')
  })
})


import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctx = vi.hoisted(() => {
  const scanMock = vi.fn()
  const delMock = vi.fn()
  const hgetallMock = vi.fn()
  const connectMock = vi.fn().mockResolvedValue(undefined)
  const quitMock = vi.fn().mockResolvedValue(undefined)

  class RedisMock {
    connect = connectMock
    quit = quitMock
    scan = scanMock
    del = delMock
    hgetall = hgetallMock
  }

  return { RedisMock, scanMock, delMock, hgetallMock, connectMock, quitMock }
})

vi.mock('ioredis', () => ({ Redis: ctx.RedisMock }))
vi.mock('@leadiya/config', () => ({
  env: { REDIS_URL: 'redis://127.0.0.1:6379', WHATSAPP_BAILEYS_ENABLED: 'true', NODE_ENV: 'test' },
  isWhatsappBusinessHoursDisabled: () => false,
}))
vi.mock('@leadiya/db', () => ({ db: { execute: vi.fn().mockResolvedValue(undefined) }, sql: vi.fn() }))

import { resetWhatsappOutboundRateKeys, getDiscoveryIntelligenceSnapshot } from './admin-operations.js'

describe('resetWhatsappOutboundRateKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses SCAN pages and deletes accumulated keys', async () => {
    ctx.scanMock
      .mockResolvedValueOnce(['1', ['wa:rate:a', 'wa:rate:b']])
      .mockResolvedValueOnce(['0', ['wa:rate:c']])
    ctx.delMock.mockResolvedValueOnce(2).mockResolvedValueOnce(1)

    const res = await resetWhatsappOutboundRateKeys()
    expect(res.deleted).toBe(3)
    expect(ctx.scanMock).toHaveBeenCalledTimes(2)
    expect(ctx.delMock).toHaveBeenNthCalledWith(1, 'wa:rate:a', 'wa:rate:b')
    expect(ctx.delMock).toHaveBeenNthCalledWith(2, 'wa:rate:c')
  })
})

describe('getDiscoveryIntelligenceSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aggregates and sorts discovery slice telemetry from Redis', async () => {
    ctx.scanMock
      .mockResolvedValueOnce(['0', ['discovery:slice:t1:almaty:restaurants', 'discovery:slice:t1:astana:cafe']])
    ctx.hgetallMock
      .mockResolvedValueOnce({
        staleRuns: '3',
        cooldownUntilMs: String(Date.now() + 60_000),
        lastRunAtMs: String(Date.now() - 10_000),
        lastNewLeads: '0',
      })
      .mockResolvedValueOnce({
        staleRuns: '1',
        cooldownUntilMs: String(Date.now()),
        lastRunAtMs: String(Date.now() - 20_000),
        lastNewLeads: '2',
      })

    const snap = await getDiscoveryIntelligenceSnapshot(10)
    expect(snap.totalSlices).toBe(2)
    expect(snap.staleSlices).toBe(2)
    expect(snap.coolingSlices).toBeGreaterThanOrEqual(1)
    expect(snap.top[0]?.sliceKey).toContain('almaty')
    expect(snap.top[0]?.staleRuns).toBe(3)
  })
})

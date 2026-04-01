import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctx = vi.hoisted(() => {
  const scanMock = vi.fn()
  const delMock = vi.fn()
  const connectMock = vi.fn().mockResolvedValue(undefined)
  const quitMock = vi.fn().mockResolvedValue(undefined)

  class RedisMock {
    connect = connectMock
    quit = quitMock
    scan = scanMock
    del = delMock
  }

  return { RedisMock, scanMock, delMock, connectMock, quitMock }
})

vi.mock('ioredis', () => ({ Redis: ctx.RedisMock }))
vi.mock('@leadiya/config', () => ({
  env: { REDIS_URL: 'redis://127.0.0.1:6379', WHATSAPP_BAILEYS_ENABLED: 'true', NODE_ENV: 'test' },
  isWhatsappBusinessHoursDisabled: () => false,
}))
vi.mock('@leadiya/db', () => ({ db: { execute: vi.fn().mockResolvedValue(undefined) }, sql: vi.fn() }))

import { resetWhatsappOutboundRateKeys } from './admin-operations.js'

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

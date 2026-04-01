import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isDuplicateInboundMessage } from './inbound-dedupe.js'

describe('isDuplicateInboundMessage', () => {
  const redis = { set: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.WHATSAPP_INBOUND_DEDUP_MSGID_TTL_SEC
    delete process.env.WHATSAPP_INBOUND_DEDUP_BODY_TTL_SEC
  })

  it('uses tenant+msgId key and marks duplicate on second seen', async () => {
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null)
    await expect(
      isDuplicateInboundMessage(redis as any, 'tenant-1', 'abc123', '77001234567@s.whatsapp.net', 'Hello'),
    ).resolves.toBe(false)
    await expect(
      isDuplicateInboundMessage(redis as any, 'tenant-1', 'abc123', '77001234567@s.whatsapp.net', 'Hello'),
    ).resolves.toBe(true)
    expect(redis.set).toHaveBeenCalledWith(
      'wa:inbound_dedup:tenant-1:abc123',
      '1',
      'EX',
      2_592_000,
      'NX',
    )
  })

  it('falls back to body hash dedupe when msgId is absent', async () => {
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null)
    await expect(
      isDuplicateInboundMessage(redis as any, 'tenant-1', undefined, '77001234567@s.whatsapp.net', 'Hi there'),
    ).resolves.toBe(false)
    await expect(
      isDuplicateInboundMessage(redis as any, 'tenant-1', undefined, '77001234567@s.whatsapp.net', 'Hi   there'),
    ).resolves.toBe(true)
    const key = redis.set.mock.calls[0]?.[0] as string
    expect(key.startsWith('wa:inbound_dedup_fallback:')).toBe(true)
  })
})

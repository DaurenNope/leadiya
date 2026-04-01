import { createHash } from 'node:crypto'

type RedisSetLike = {
  set: (
    key: string,
    value: string,
    mode: 'EX',
    ttlSeconds: number,
    nx: 'NX',
  ) => Promise<string | null>
}

const DEFAULT_MSG_ID_TTL_SEC = 30 * 24 * 60 * 60 // 30 days
const DEFAULT_BODY_FALLBACK_TTL_SEC = 6 * 60 * 60 // 6 hours

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw ? Number.parseInt(raw, 10) : fallback
  if (!Number.isFinite(n) || n < 1) return fallback
  return n
}

function normalizeBody(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Returns true when this inbound looks like a duplicate and should be skipped.
 * Prefer stable WA msg id dedupe; fall back to a short-lived content hash only when msg id is missing.
 */
export async function isDuplicateInboundMessage(
  redis: RedisSetLike,
  tenantId: string,
  msgId: string | null | undefined,
  waPeer: string,
  body: string,
): Promise<boolean> {
  const msgIdTtl = parsePositiveInt(process.env.WHATSAPP_INBOUND_DEDUP_MSGID_TTL_SEC, DEFAULT_MSG_ID_TTL_SEC)
  const bodyTtl = parsePositiveInt(
    process.env.WHATSAPP_INBOUND_DEDUP_BODY_TTL_SEC,
    DEFAULT_BODY_FALLBACK_TTL_SEC,
  )

  if (msgId?.trim()) {
    const key = `wa:inbound_dedup:${tenantId}:${msgId.trim()}`
    const isNew = await redis.set(key, '1', 'EX', msgIdTtl, 'NX')
    return !isNew
  }

  const hash = createHash('sha1')
    .update(`${tenantId}|${waPeer}|${normalizeBody(body)}`)
    .digest('hex')
  const key = `wa:inbound_dedup_fallback:${hash}`
  const isNew = await redis.set(key, '1', 'EX', bodyTtl, 'NX')
  return !isNew
}

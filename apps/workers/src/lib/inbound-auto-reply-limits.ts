/**
 * Rolling window cap on automated WhatsApp outbounds per lead (see inbound-reply.ts).
 * Env OUTREACH_MAX_INBOUND_AUTO_REPLIES — default 5, max 100.
 */
export function maxInboundAutoReplies(): number {
  const raw = process.env.OUTREACH_MAX_INBOUND_AUTO_REPLIES?.trim()
  const n = raw ? parseInt(raw, 10) : 5
  if (!Number.isFinite(n) || n < 1) return 5
  return Math.min(n, 100)
}

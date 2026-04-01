/**
 * Parses OUTREACH_MAX_INBOUND_AUTO_REPLIES for any future outbound-side limiters.
 * Inbound auto-replies (handleInboundReply) are not capped by this — the handler only
 * runs when the customer sends a message.
 */
export function maxInboundAutoReplies(): number {
  const raw = process.env.OUTREACH_MAX_INBOUND_AUTO_REPLIES?.trim()
  const n = raw ? parseInt(raw, 10) : 5
  if (!Number.isFinite(n) || n < 1) return 5
  return Math.min(n, 100)
}

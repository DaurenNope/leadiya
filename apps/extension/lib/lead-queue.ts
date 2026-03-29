export type LeadForQueue = {
  name: string
  city?: string
  sourceUrl?: string
}

export function leadFingerprint(lead: LeadForQueue): string {
  const name = (lead.name || '').trim().toLowerCase()
  const city = (lead.city || '').trim().toLowerCase()
  const sourceUrl = (lead.sourceUrl || '').trim().toLowerCase()
  return `${name}|${city}|${sourceUrl}`
}

export function shouldEnqueueLead(
  lead: LeadForQueue,
  recent: Map<string, number>,
  nowMs: number,
  windowMs: number,
): boolean {
  const key = leadFingerprint(lead)
  const prev = recent.get(key)
  if (prev != null && nowMs - prev < windowMs) return false
  recent.set(key, nowMs)
  return true
}

export function pruneRecent(recent: Map<string, number>, nowMs: number, windowMs: number): void {
  for (const [k, ts] of recent.entries()) {
    if (nowMs - ts >= windowMs) recent.delete(k)
  }
}

export function normalizeApiOrigin(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/$/, '')
  if (!trimmed) return null
  const prefixed = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const u = new URL(prefixed)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}


/** Human-readable delay from sequences.yml (`0`, `3d`, `2h`, etc.) */
export function formatSequenceDelay(delay: unknown): string {
  if (delay == null || delay === '' || delay === 0) return 'Сразу'
  if (typeof delay === 'number') {
    if (delay === 0) return 'Сразу'
    if (delay >= 86_400_000) return `+${Math.round(delay / 86_400_000)} дн`
    if (delay >= 3_600_000) return `+${Math.round(delay / 3_600_000)} ч`
    return `+${Math.round(delay / 60_000)} мин`
  }
  const s = String(delay).trim().toLowerCase()
  if (s === '0') return 'Сразу'
  const mLong = /^(\d+(?:\.\d+)?)\s*(d|day|days|h|hr|hour|hours|m|min|mins)$/i.exec(s)
  const mShort = /^(\d+)([dhm])$/i.exec(s)
  const m = mLong ?? mShort
  if (m) {
    const n = Number(m[1])
    const u = m[2].toLowerCase()
    if (u.startsWith('d')) return `+${n} дн`
    if (u.startsWith('h')) return `+${n} ч`
    return `+${n} мин`
  }
  return String(delay)
}

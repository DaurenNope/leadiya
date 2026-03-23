export interface StatResult {
  bin: string
  employeeBand: string | null
  revenueKzt: number | null
}

const STAT_BASE = 'https://stat.gov.kz/api/juridical/counter/api/'
const TIMEOUT_MS = 20_000

/**
 * Enrich from stat.gov.kz — employee count and revenue by BIN.
 * Note: this endpoint was returning 404 as of March 2026 research.
 * The function handles failure gracefully and returns null.
 */
export async function enrichFromStat(bin: string): Promise<StatResult | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

    const res = await fetch(`${STAT_BASE}?bin=${encodeURIComponent(bin)}&lang=ru`, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    })
    clearTimeout(timer)

    if (!res.ok) return null

    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('json')) return null

    const data = (await res.json()) as Record<string, unknown>
    if (!data) return null

    const employees = typeof data.workers === 'number' ? data.workers : null
    const employeeBand = employees != null
      ? employees < 15
        ? 'micro'
        : employees < 100
          ? 'small'
          : employees < 250
            ? 'medium'
            : 'large'
      : null

    const revenue = typeof data.revenue === 'number' ? data.revenue : null

    return { bin, employeeBand, revenueKzt: revenue }
  } catch {
    return null
  }
}

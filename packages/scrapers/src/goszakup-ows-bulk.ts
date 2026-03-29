/**
 * Goszakup OWS v3 — bulk read of nationwide lot feed (not per-BIN).
 * Docs: https://goszakup.gov.kz/ru/developer/ows_v3
 *
 * Pagination uses cursor links in `next_page` (not numeric page=).
 * Requires GOSZAKUP_API_TOKEN (Bearer).
 */

const GOSZAKUP_TOKEN = process.env.GOSZAKUP_API_TOKEN?.trim() || ''
const OWS_BASE = 'https://ows.goszakup.gov.kz/v3'
const TIMEOUT_MS = 60_000

export interface GoszakupLotRow {
  id: number
  lot_number?: string
  ref_lot_status_id?: number
  customer_bin?: string | null
  name_ru?: string
  name_kz?: string
  amount?: number
  trd_buy_number_anno?: string
  trd_buy_id?: number
  [key: string]: unknown
}

interface LotsPage {
  total?: number
  limit?: number
  next_page?: string
  items?: GoszakupLotRow[]
}

export class GoszakupOwsError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'GoszakupOwsError'
  }
}

function joinOwsPath(nextPath: string): string {
  if (nextPath.startsWith('http://') || nextPath.startsWith('https://')) return nextPath
  if (nextPath.startsWith('/v3/')) return `https://ows.goszakup.gov.kz${nextPath}`
  if (nextPath.startsWith('/')) return `${OWS_BASE}${nextPath}`
  return `${OWS_BASE}/${nextPath}`
}

/**
 * Single page from GET /v3/lots or a follow-up `next_page` URL/path.
 */
export async function fetchGoszakupLotsPage(pathOrUrl: string = '/lots'): Promise<LotsPage> {
  if (!GOSZAKUP_TOKEN) {
    throw new GoszakupOwsError('Missing GOSZAKUP_API_TOKEN')
  }

  const url = joinOwsPath(pathOrUrl.startsWith('http') ? pathOrUrl : pathOrUrl)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${GOSZAKUP_TOKEN}`,
        Accept: 'application/json',
      },
    })
    clearTimeout(timer)

    if (res.status === 401) {
      throw new GoszakupOwsError('Goszakup OWS returned 401 (invalid or expired token)', 401)
    }

    const data = (await res.json()) as LotsPage & { message?: string; name?: string }
    if (!res.ok) {
      throw new GoszakupOwsError(
        data.message || data.name || `Goszakup HTTP ${res.status}`,
        res.status
      )
    }

    return data
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof GoszakupOwsError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('abort')) throw new GoszakupOwsError('Goszakup request timed out')
    throw new GoszakupOwsError(msg)
  }
}

/**
 * Walk the full lots index via `next_page` until exhausted or maxPages reached.
 */
export async function* iterateGoszakupLots(options?: {
  maxPages?: number
}): AsyncGenerator<GoszakupLotRow, void, undefined> {
  let path: string | null = '/lots'
  let pages = 0
  const maxPages = options?.maxPages ?? Infinity

  while (path && pages < maxPages) {
    const page = await fetchGoszakupLotsPage(path)
    const items = page.items ?? []
    for (const row of items) yield row

    const next = page.next_page?.trim()
    path = next || null
    pages++
  }
}

export function isGoszakupBulkAvailable(): boolean {
  return !!GOSZAKUP_TOKEN
}

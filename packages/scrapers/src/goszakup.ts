import { db, tenders, companies, eq } from '@leadiya/db'

const GOSZAKUP_TOKEN = process.env.GOSZAKUP_API_TOKEN?.trim() || ''
const OWS_BASE = 'https://ows.goszakup.gov.kz/v3'
const TIMEOUT_MS = 30_000

interface GoszakupLot {
  id: number
  lot_number: string
  ref_lot_status_id: number
  customer_bin: string
  name_ru: string
  amount: number
  trd_buy_number_anno: string
  published_at?: string
}

interface LotsResponse {
  total: number
  next_page?: string
  items: GoszakupLot[]
}

async function fetchLotsForBin(bin: string): Promise<GoszakupLot[]> {
  if (!GOSZAKUP_TOKEN) return []

  const all: GoszakupLot[] = []
  let path = `/lots/bin/${encodeURIComponent(bin)}`

  while (path) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(`${OWS_BASE}${path}`, {
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${GOSZAKUP_TOKEN}`,
          Accept: 'application/json',
        },
      })
      clearTimeout(timer)

      if (!res.ok) {
        if (res.status === 401) console.warn('[goszakup] Invalid or expired API token')
        break
      }

      const data = (await res.json()) as LotsResponse
      if (data.items?.length) all.push(...data.items)
      path = data.next_page || ''
    } catch (e) {
      clearTimeout(timer)
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.includes('abort')) console.warn(`[goszakup] ${bin}: ${msg}`)
      break
    }
  }

  return all
}

/**
 * Fetch tenders for a specific company BIN and upsert into the tenders table.
 * Requires GOSZAKUP_API_TOKEN env var.
 */
export async function enrichTendersForBin(bin: string): Promise<{ tenderCount: number }> {
  const lots = await fetchLotsForBin(bin)
  if (!lots.length) return { tenderCount: 0 }

  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.bin, bin))
    .limit(1)

  if (!company) return { tenderCount: 0 }

  let count = 0
  for (const lot of lots) {
    await db
      .insert(tenders)
      .values({
        companyId: company.id,
        portal: 'goszakup',
        lotNumber: String(lot.lot_number || lot.id),
        subject: lot.name_ru || null,
        budgetKzt: lot.amount ? String(lot.amount) : null,
        status: lot.ref_lot_status_id === 220 ? 'open' : 'closed',
      })
      .onConflictDoUpdate({
        target: [tenders.lotNumber],
        set: {
          status: lot.ref_lot_status_id === 220 ? 'open' : 'closed',
          budgetKzt: lot.amount ? String(lot.amount) : null,
        },
      })
    count++
  }

  return { tenderCount: count }
}

export function isGoszakupAvailable(): boolean {
  return !!GOSZAKUP_TOKEN
}

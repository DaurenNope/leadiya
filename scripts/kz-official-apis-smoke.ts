/**
 * Smoke-test Kazakhstan official open APIs used for foundation data.
 *
 * eGov:   no token — https://data.egov.kz/pages/samples
 * Goszakup OWS: needs GOSZAKUP_API_TOKEN — https://goszakup.gov.kz/ru/developer/ows_v3
 *
 * Run:
 *   npx tsx scripts/kz-official-apis-smoke.ts
 *   npx tsx --env-file=.env scripts/kz-official-apis-smoke.ts
 */
import { EgovApiError, fetchEgovLegalEntitiesPage } from '../packages/scrapers/src/egov-open-data.js'
import {
  fetchGoszakupLotsPage,
  GoszakupOwsError,
  isGoszakupBulkAvailable,
} from '../packages/scrapers/src/goszakup-ows-bulk.js'

async function main() {
  console.log('--- data.egov.kz (legal_entities, first page) ---')
  try {
    const rows = await fetchEgovLegalEntitiesPage({ from: 0, size: 3 })
    console.log(`OK: ${rows.length} row(s)`)
    if (rows[0]) console.log('Sample keys:', Object.keys(rows[0]).slice(0, 12).join(', '))
  } catch (e) {
    if (e instanceof EgovApiError) {
      console.error('eGov failed:', e.message, e.status != null ? `(HTTP ${e.status})` : '')
      if (e.bodySnippet) console.error('Snippet:', e.bodySnippet.replace(/\s+/g, ' ').slice(0, 120))
    } else throw e
  }

  console.log('\n--- ows.goszakup.gov.kz /v3/lots (first page) ---')
  if (!isGoszakupBulkAvailable()) {
    console.log('Skip: set GOSZAKUP_API_TOKEN to test Goszakup.')
    return
  }
  try {
    const page = await fetchGoszakupLotsPage('/lots')
    const n = page.items?.length ?? 0
    console.log(`OK: ${n} lot(s) on page, total≈${page.total ?? '?'}, next_page=${page.next_page ? 'yes' : 'no'}`)
    if (page.items?.[0]) {
      const x = page.items[0]
      console.log('Sample:', { id: x.id, lot_number: x.lot_number, customer_bin: x.customer_bin })
    }
  } catch (e) {
    if (e instanceof GoszakupOwsError) {
      console.error('Goszakup failed:', e.message, e.status != null ? `(HTTP ${e.status})` : '')
    } else throw e
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

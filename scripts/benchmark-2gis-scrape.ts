/**
 * Time a real 2GIS scrape (list + detail + DB). Requires repo root `.env` (same as API/workers).
 *
 *   npx tsx scripts/benchmark-2gis-scrape.ts
 *   npx tsx scripts/benchmark-2gis-scrape.ts --list-strategy dom
 *   npx tsx scripts/benchmark-2gis-scrape.ts --quick   # same as --list-strategy dom (fewer list URLs, faster)
 *
 * Default slice: Алматы × Кафе (adjust below or extend CLI if needed).
 */
import { performance } from 'node:perf_hooks'
import { run2GisScraper } from '../packages/scrapers/src/twogis.ts'
import type { TwogisListStrategy } from '../packages/scrapers/src/twogis-list-collector.ts'

function parseListStrategy(): TwogisListStrategy {
  if (process.argv.includes('--quick')) return 'dom'
  const i = process.argv.indexOf('--list-strategy')
  if (i >= 0 && process.argv[i + 1]) {
    const v = process.argv[i + 1] as TwogisListStrategy
    if (v === 'dom' || v === 'network' || v === 'hybrid') return v
    console.warn(`Unknown --list-strategy ${v}, using hybrid`)
  }
  return 'hybrid'
}

async function main() {
  const listStrategy = parseListStrategy()
  const cities = ['Алматы']
  const categories = ['Кафе']

  console.log('2GIS scrape benchmark')
  console.log(`  cities: ${cities.join(', ')}`)
  console.log(`  categories: ${categories.join(', ')}`)
  console.log(`  listStrategy: ${listStrategy}`)
  console.log(`  headless: true`)
  console.log('')

  const t0 = performance.now()
  const result = await run2GisScraper({
    cities,
    categories,
    headless: true,
    listStrategy,
  })
  const leadsSaved = result.total
  const wallMs = performance.now() - t0
  const wallSec = wallMs / 1000
  const rate = leadsSaved > 0 ? leadsSaved / wallSec : 0

  console.log('')
  console.log('══════════════════════════════════════')
  console.log('BENCHMARK RESULT')
  console.log('══════════════════════════════════════')
  console.log(`Wall time:     ${wallSec.toFixed(2)} s (${Math.round(wallMs)} ms)`)
  console.log(`Leads saved:   ${leadsSaved} (new/updated this run; see scraper logs for skips)`)
  console.log(
    `Throughput:    ${rate > 0 ? `${rate.toFixed(2)} leads/s (~${(wallSec / leadsSaved).toFixed(1)} s per saved lead)` : 'n/a (0 new saves — often duplicates on re-run)'}`
  )
  console.log(
    'Note:         Stage 2 website enrichment runs in the background (p-limit); wall time can include queued work finishing after the summary.'
  )
  console.log('══════════════════════════════════════')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

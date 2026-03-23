/**
 * 2GIS collection: universities, institutes, colleges, business schools — orgs with real budgets.
 *
 *   npx tsx --env-file=.env scripts/scrape-education-hei.ts
 *
 * Scale up: edit CITIES / CATEGORIES / limits / maxConcurrency at the bottom.
 * Proxy: set `SMARTPROXY_USER` + `SMARTPROXY_PASS` in `.env` and `skipProxy: false` below for production egress.
 */
import { performance } from 'node:perf_hooks'
import { run2GisScraper } from '../packages/scrapers/src/twogis.ts'

/** Major KZ cities (same set as dashboard / twogis). Trim to 2–3 for a faster first pass. */
const CITIES = [
  'Алматы',
  'Астана',
  'Шымкент',
  'Актобе',
  'Караганда',
  'Тараз',
  'Усть-Каменогорск',
  'Костанай',
  'Павлодар',
] as const

/**
 * 2GIS search queries (Russian) — tuned for higher-ed and paid B2B education, not kids’ tutors.
 */
const CATEGORIES = [
  'Университеты',
  'Институты',
  'Академии',
  'Колледжи',
  'Высшие учебные заведения',
  'Негосударственные вузы',
  'Бизнес-школы',
  'Филиалы университетов',
] as const

async function main() {
  const maxConcurrency = 2
  const limits = { maxListPages: 4, maxFirmDetailAttempts: 35 }
  const skipProxy = true

  console.log('2GIS — education / HEI (paying organizations)')
  console.log(`  Cities (${CITIES.length}):`, [...CITIES].join(', '))
  console.log(`  Categories (${CATEGORIES.length}):`, [...CATEGORIES].join(', '))
  console.log(`  maxConcurrency: ${maxConcurrency}`)
  console.log(`  limits:`, limits)
  console.log(`  skipProxy: ${skipProxy} (set false + SmartProxy in .env for blocked IPs)`)
  console.log('')

  const t0 = performance.now()
  const result = await run2GisScraper({
    cities: [...CITIES],
    categories: [...CATEGORIES],
    headless: true,
    listStrategy: 'hybrid',
    maxConcurrency,
    skipProxy,
    resumeCheckpoint: true,
    limits,
  })
  const sec = (performance.now() - t0) / 1000

  console.log('')
  console.log('══════════════════════════════════════')
  console.log('EDUCATION / HEI RUN DONE')
  console.log('══════════════════════════════════════')
  console.log(`Wall time:     ${sec.toFixed(0)} s`)
  console.log(`Leads saved:   ${result.total}`)
  console.log(`New lead IDs:  ${result.leadIds.length}`)
  if (result.runId) console.log(`scraper_run:   ${result.runId}`)
  console.log('')
  console.log(
    'Quality check: npx tsx --env-file=.env scripts/evaluate-leads-quality.ts --hours=72 --education'
  )
  console.log('══════════════════════════════════════')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

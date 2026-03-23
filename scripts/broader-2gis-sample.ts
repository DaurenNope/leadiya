/**
 * Broader-than-smoke 2GIS collection run (bounded so it finishes in ~10–25 min).
 *
 *   npx tsx --env-file=.env scripts/broader-2gis-sample.ts
 *
 * Tweak CITIES / CATEGORIES / limits at the bottom for more data.
 * Uses skipProxy for reliability on direct egress; set useProxy: true in code if you need SmartProxy.
 */
import { performance } from 'node:perf_hooks'
import { run2GisScraper } from '../packages/scrapers/src/twogis.ts'

/** Wider sample: 4 cities × 3 categories = 12 parallel slices (max 8 firm details each). */
const CITIES = ['Алматы', 'Астана', 'Шымкент', 'Актобе'] as const
const CATEGORIES = ['IT-компании', 'Кафе', 'Рестораны'] as const

async function main() {
  const maxConcurrency = 3
  const limits = { maxListPages: 2, maxFirmDetailAttempts: 8 }

  console.log('Broader 2GIS sample run')
  console.log(`  Cities (${CITIES.length}):`, [...CITIES].join(', '))
  console.log(`  Categories (${CATEGORIES.length}):`, [...CATEGORIES].join(', '))
  console.log(`  maxConcurrency: ${maxConcurrency}`)
  console.log(`  limits:`, limits)
  console.log(`  skipProxy: true (set false in script if using SmartProxy only)`)
  console.log('')

  const t0 = performance.now()
  const result = await run2GisScraper({
    cities: [...CITIES],
    categories: [...CATEGORIES],
    headless: true,
    listStrategy: 'hybrid',
    maxConcurrency,
    skipProxy: true,
    resumeCheckpoint: true,
    limits,
  })
  const sec = (performance.now() - t0) / 1000

  console.log('')
  console.log('══════════════════════════════════════')
  console.log('BROADER RUN DONE')
  console.log('══════════════════════════════════════')
  console.log(`Wall time:     ${sec.toFixed(0)} s`)
  console.log(`Leads saved:   ${result.total} (this run — new/updated rows counted by scraper)`)
  console.log(`New lead IDs:  ${result.leadIds.length}`)
  if (result.runId) console.log(`scraper_run:   ${result.runId}`)
  console.log('')
  console.log('Next: npx tsx --env-file=.env scripts/evaluate-leads-quality.ts')
  console.log('══════════════════════════════════════')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

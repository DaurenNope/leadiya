/**
 * Short parallel 2GIS run to verify Crawlee maxConcurrency (3 slices × 1 detail each).
 *
 *   cd repo root && npx tsx --env-file=.env scripts/parallel-smoke-2gis.ts
 *
 * Requires `.env` with DATABASE_URL (same as API).
 * Uses `skipProxy: true` so the run finishes quickly; production jobs should use SmartProxy.
 */
import { performance } from 'node:perf_hooks'
import { run2GisScraper } from '../packages/scrapers/src/twogis.ts'

async function main() {
  const cities = ['Алматы']
  const categories = ['IT-компании', 'Кафе', 'Рестораны']
  const maxConcurrency = 3

  console.log('Parallel smoke test')
  console.log(`  cities: ${cities.join(', ')}`)
  console.log(`  categories (${categories.length}): ${categories.join(', ')}`)
  console.log(`  maxConcurrency: ${maxConcurrency}`)
  console.log(`  limits: 1 list page, 1 firm detail per slice`)
  console.log('')

  const t0 = performance.now()
  const result = await run2GisScraper({
    cities,
    categories,
    headless: true,
    listStrategy: 'hybrid',
    maxConcurrency,
    skipProxy: true,
    resumeCheckpoint: false,
    limits: { maxListPages: 1, maxFirmDetailAttempts: 1 },
  })
  const sec = (performance.now() - t0) / 1000

  console.log('')
  console.log('══════════════════════════════════════')
  console.log('SMOKE RESULT')
  console.log('══════════════════════════════════════')
  console.log(`Wall time:   ${sec.toFixed(1)} s`)
  console.log(`Total saved: ${result.total} (this run)`)
  console.log(`New IDs:     ${result.leadIds.length}`)
  console.log('══════════════════════════════════════')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

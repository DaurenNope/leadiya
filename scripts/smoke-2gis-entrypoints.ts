/**
 * Compare the same scrape parameters in-process vs POST /api/scrapers/2gis.
 *
 *   npx tsx --env-file=.env scripts/smoke-2gis-entrypoints.ts
 *   SMOKE_API_ORIGIN=http://localhost:9999 npx tsx --env-file=.env scripts/smoke-2gis-entrypoints.ts
 *
 * Requires: DB + API reachable (part 2 only), Playwright, same .env as API.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { run2GisScraper } from '../packages/scrapers/src/twogis.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
let smokeDefaultPort = 3041
try {
  const j = JSON.parse(readFileSync(join(repoRoot, 'dev-ports.json'), 'utf8')) as {
    localCliApiPort?: number
  }
  if (typeof j.localCliApiPort === 'number') smokeDefaultPort = j.localCliApiPort
} catch {
  /* use fallback */
}
const API = (process.env.SMOKE_API_ORIGIN ?? `http://localhost:${smokeDefaultPort}`).replace(/\/$/, '')

const payload = {
  cities: ['Алматы'] as string[],
  categories: ['Кафе'] as string[],
  headless: true,
  listStrategy: 'hybrid' as const,
  resumeCheckpoint: false,
  limits: { maxListPages: 1, maxFirmDetailAttempts: 2 },
}

function ms(since: number) {
  return `${Math.round(performance.now() - since)} ms`
}

async function pollRun(runId: string, timeoutMs: number) {
  const t0 = performance.now()
  while (performance.now() - t0 < timeoutMs) {
    const r = await fetch(`${API}/api/scrapers/runs/${runId}`)
    if (!r.ok) throw new Error(`poll HTTP ${r.status}`)
    const row = (await r.json()) as { status: string; resultsCount: number | null; error: string | null }
    const st = row.status.toLowerCase()
    console.log(`  [poll] ${st} resultsCount=${row.resultsCount ?? 'null'}`)
    if (st !== 'running') return row
    await new Promise((res) => setTimeout(res, 4000))
  }
  throw new Error('poll timeout')
}

async function main() {
  console.log('Payload (both paths):', JSON.stringify(payload))
  console.log('')

  console.log('=== A) Direct run2GisScraper (no HTTP, no scraperRunId) ===')
  const tA = performance.now()
  let direct
  try {
    direct = await run2GisScraper({
      cities: payload.cities,
      categories: payload.categories,
      headless: payload.headless,
      listStrategy: payload.listStrategy,
      resumeCheckpoint: payload.resumeCheckpoint,
      limits: payload.limits,
    })
    console.log('A result:', direct, `(${ms(tA)})`)
  } catch (e) {
    console.error('A FAILED:', e instanceof Error ? e.message : e, `(${ms(tA)})`)
  }

  console.log('')
  console.log(`=== B) POST ${API}/api/scrapers/2gis (same JSON body as UI can send) ===`)
  const tB = performance.now()
  try {
    const res = await fetch(`${API}/api/scrapers/2gis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await res.json()) as { runId?: string; error?: string; existing?: boolean; message?: string }
    console.log(`B HTTP ${res.status}`, body, `(${ms(tB)} to respond)`)
    if (!body.runId) {
      console.error('B: no runId — is another 2GIS job running?')
      return
    }
    const final = await pollRun(body.runId, 15 * 60_000)
    console.log('B final row:', final, `(${ms(tB)} total since POST)`)
  } catch (e) {
    console.error('B FAILED:', e instanceof Error ? e.message : e, `(${ms(tB)})`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

import { Worker } from 'bullmq'
import { run2GisScraper } from '@leadiya/scrapers'
import { db, scraperRuns, eq } from '@leadiya/db'
import { env } from '@leadiya/config'
import { enqueueEnrichmentForLeads } from '../enqueue-enrichment.js'
import {
  discoverySliceKey,
  shouldRunSlice,
  loadSliceState,
  computeAdaptiveLimits,
  saveSliceOutcome,
} from '../lib/discovery-intelligence.js'

async function hasActiveRun(): Promise<boolean> {
  const [row] = await db
    .select({ id: scraperRuns.id })
    .from(scraperRuns)
    .where(eq(scraperRuns.status, 'running'))
    .limit(1)
  return !!row
}

const discoveryWorker = new Worker(
  'discovery',
  async (job) => {
    const { city, category, tenantId, scraper } = job.data as {
      city: string
      category: string
      tenantId?: string
      scraper?: string
    }

    if (await hasActiveRun()) {
      console.log(`[discovery] Skipping ${city} / ${category} — another run is already active`)
      return { skipped: true }
    }

    const sliceKey = discoverySliceKey(tenantId, city, category)
    if (!(await shouldRunSlice(sliceKey))) {
      const st = await loadSliceState(sliceKey)
      const waitMin = Math.max(1, Math.round((st.cooldownUntilMs - Date.now()) / 60000))
      console.log(`[discovery] Skipping ${city} / ${category} — cooldown active (${waitMin}m left)`)
      return { skipped: true, reason: 'cooldown' }
    }

    const state = await loadSliceState(sliceKey)
    const limits = computeAdaptiveLimits(state.staleRuns)
    const scope = [scraper && `scraper=${scraper}`, tenantId && `tenant=${tenantId}`].filter(Boolean).join(' ')
    console.log(
      `[discovery] ${city} / ${category}${scope ? ` (${scope})` : ''} ` +
      `(smart limits: pages<=${limits.maxListPages}, details<=${limits.maxFirmDetailAttempts}, staleRuns=${state.staleRuns})`,
    )

    const result = await run2GisScraper({
      cities: [city],
      categories: [category],
      resumeCheckpoint: true,
      limits: {
        maxListPages: limits.maxListPages,
        maxFirmDetailAttempts: limits.maxFirmDetailAttempts,
      },
    })

    if (result.leadIds.length > 0) {
      console.log(`[discovery] Enqueueing enrichment for ${result.leadIds.length} new leads`)
      await enqueueEnrichmentForLeads(result.leadIds)
    }
    await saveSliceOutcome(sliceKey, result.leadIds.length)

    return { total: result.total, leadIds: result.leadIds.length }
  },
  {
    connection: { url: env.REDIS_URL },
    concurrency: 1,
  }
)

discoveryWorker.on('completed', (job) => {
  console.log(`[discovery] Job ${job.id} completed`)
})

discoveryWorker.on('failed', (job, err) => {
  console.error(`[discovery] Job ${job?.id} failed:`, err.message)
})

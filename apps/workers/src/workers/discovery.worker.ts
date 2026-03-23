import { Worker } from 'bullmq'
import { run2GisScraper } from '@leadiya/scrapers'
import { enqueueEnrichmentForLeads } from '../enqueue-enrichment.js'

const discoveryWorker = new Worker(
  'discovery',
  async (job) => {
    const { city, category } = job.data as { city: string; category: string }
    console.log(`[discovery] ${city} / ${category}`)

    const result = await run2GisScraper({
      cities: [city],
      categories: [category],
      resumeCheckpoint: true,
    })

    if (result.leadIds.length > 0) {
      console.log(`[discovery] Enqueueing enrichment for ${result.leadIds.length} new leads`)
      await enqueueEnrichmentForLeads(result.leadIds)
    }

    return { total: result.total, leadIds: result.leadIds.length }
  },
  {
    connection: { url: process.env.REDIS_URL },
    concurrency: 1,
  }
)

discoveryWorker.on('completed', (job) => {
  console.log(`[discovery] Job ${job.id} completed`)
})

discoveryWorker.on('failed', (job, err) => {
  console.error(`[discovery] Job ${job?.id} failed:`, err.message)
})

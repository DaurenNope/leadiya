import { Worker } from 'bullmq'
import { enqueueEnrichmentForLeads } from '../enqueue-enrichment.js'

/**
 * Generic enrichment worker — receives a batch of lead IDs and fans out
 * to per-source queues. Used by the API's bulk-enrich endpoint.
 */
const enrichmentWorker = new Worker(
  'enrichment',
  async (job) => {
    const { leadIds } = job.data as { leadIds: string[] }
    console.log(`[enrichment] Batch: ${leadIds.length} leads`)
    await enqueueEnrichmentForLeads(leadIds)
    return { enqueued: leadIds.length }
  },
  {
    connection: { url: process.env.REDIS_URL },
    concurrency: 5,
  }
)

enrichmentWorker.on('failed', (job, err) => {
  console.error(`[enrichment] Job ${job?.id} failed:`, err.message)
})

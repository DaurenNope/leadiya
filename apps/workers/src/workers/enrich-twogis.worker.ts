import { Worker } from 'bullmq'
import { enrichLeadFromTwogisSearch } from '@leadiya/scrapers'

const worker = new Worker(
  'enrich-twogis',
  async (job) => {
    const { leadId, force } = job.data as { leadId: string; force?: boolean }
    console.log(`[enrich:twogis] ${leadId}${force ? ' (force)' : ''}`)
    const result = await enrichLeadFromTwogisSearch(leadId, {
      force: Boolean(force),
      headless: process.env.TWOGIS_ENRICH_HEADLESS !== '0',
      skipProxy: process.env.TWOGIS_ENRICH_SKIP_PROXY === '1',
    })
    if (result.skipped) {
      console.log(`[enrich:twogis] ${leadId} skipped (already 2GIS or enriched)`)
      return result
    }
    if (!result.success) {
      console.warn(`[enrich:twogis] ${leadId}: ${result.error}`)
    }
    return result
  },
  {
    connection: { url: process.env.REDIS_URL },
    concurrency: 1,
  }
)

worker.on('failed', (job, err) => {
  console.error(`[enrich:twogis] Job ${job?.id} failed:`, err.message)
})

import { Worker } from 'bullmq'
import { enrichLeadWithWebsite } from '@leadiya/scrapers'

const worker = new Worker(
  'enrich-website',
  async (job) => {
    const { leadId, website } = job.data as { leadId: string; website: string }
    console.log(`[enrich:website] ${leadId} → ${website}`)
    const result = await enrichLeadWithWebsite(leadId, website)
    if (!result.success) {
      console.warn(`[enrich:website] ${leadId} failed: ${result.error}`)
    }
    return result
  },
  {
    connection: { url: process.env.REDIS_URL },
    concurrency: 3,
  }
)

worker.on('failed', (job, err) => {
  console.error(`[enrich:website] Job ${job?.id} failed:`, err.message)
})

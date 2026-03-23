import { Worker } from 'bullmq'
import { enrichTendersForBin } from '@leadiya/scrapers'
import { db, leads, eq } from '@leadiya/db'

const worker = new Worker(
  'enrich-goszakup',
  async (job) => {
    const { leadId, bin } = job.data as { leadId: string; bin: string }
    console.log(`[enrich:goszakup] ${leadId} (${bin})`)

    const result = await enrichTendersForBin(bin)
    const existing = await db.select({ enrichmentSources: leads.enrichmentSources }).from(leads).where(eq(leads.id, leadId)).limit(1)
    const prev = (existing[0]?.enrichmentSources ?? {}) as Record<string, unknown>

    await db
      .update(leads)
      .set({
        enrichmentSources: {
          ...prev,
          goszakup: { at: new Date().toISOString(), status: 'ok', tenders: result.tenderCount },
        },
        lastEnrichedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId))

    return result
  },
  {
    connection: { url: process.env.REDIS_URL },
    concurrency: 3,
  }
)

worker.on('failed', (job, err) => {
  console.error(`[enrich:goszakup] Job ${job?.id} failed:`, err.message)
})

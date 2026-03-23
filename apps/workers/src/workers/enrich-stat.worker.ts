import { Worker } from 'bullmq'
import { enrichFromStat } from '@leadiya/scrapers'
import { db, leads, eq } from '@leadiya/db'

const worker = new Worker(
  'enrich-stat',
  async (job) => {
    const { leadId, bin } = job.data as { leadId: string; bin: string }
    console.log(`[enrich:stat] ${leadId} (${bin})`)

    const result = await enrichFromStat(bin)
    const existing = await db.select({ enrichmentSources: leads.enrichmentSources }).from(leads).where(eq(leads.id, leadId)).limit(1)
    const prev = (existing[0]?.enrichmentSources ?? {}) as Record<string, unknown>

    if (result) {
      await db
        .update(leads)
        .set({
          employeeBand: result.employeeBand,
          enrichmentSources: { ...prev, stat: { at: new Date().toISOString(), status: 'ok' } },
          lastEnrichedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId))
    } else {
      await db
        .update(leads)
        .set({
          enrichmentSources: { ...prev, stat: { at: new Date().toISOString(), status: 'unavailable' } },
          updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId))
    }

    return result
  },
  {
    connection: { url: process.env.REDIS_URL },
    concurrency: 5,
  }
)

worker.on('failed', (job, err) => {
  console.error(`[enrich:stat] Job ${job?.id} failed:`, err.message)
})

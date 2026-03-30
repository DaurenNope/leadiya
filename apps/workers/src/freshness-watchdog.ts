import cron from 'node-cron'
import { db, leads } from '@leadiya/db'
import { sql } from 'drizzle-orm'
import { enqueueEnrichmentForLeads } from './enqueue-enrichment.js'
import { withCronLock } from './lib/cron-lock.js'

cron.schedule('0 */6 * * *', async () => {
  await withCronLock('freshness-enrichment', 3600, async () => {
  console.log('[watchdog] Checking for leads needing enrichment...')

  const stale = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      sql`${leads.lastEnrichedAt} IS NULL OR ${leads.lastEnrichedAt} < NOW() - INTERVAL '30 days'`
    )
    .limit(500)

  if (stale.length > 0) {
    const ids = stale.map((r) => r.id)
    await enqueueEnrichmentForLeads(ids)
    console.log(`[watchdog] Re-queued ${ids.length} stale leads for enrichment`)
  } else {
    console.log('[watchdog] No stale leads found')
  }
  })
})

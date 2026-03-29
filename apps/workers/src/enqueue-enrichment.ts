import { db, leads, eq } from '@leadiya/db'
import { inArray } from 'drizzle-orm'
import {
  websiteEnrichQueue,
  statEnrichQueue,
  uchetEnrichQueue,
  goszakupEnrichQueue,
  twogisEnrichQueue,
} from './queues.js'

/**
 * Enqueue per-source enrichment jobs for a batch of lead IDs.
 * Idempotent: skips sources that already have data in enrichmentSources.
 */
export async function enqueueEnrichmentForLeads(leadIds: string[]) {
  if (!leadIds.length) return

  const rows = await db
    .select({
      id: leads.id,
      name: leads.name,
      source: leads.source,
      bin: leads.bin,
      website: leads.website,
      enrichmentSources: leads.enrichmentSources,
    })
    .from(leads)
    .where(inArray(leads.id, leadIds))

  for (const lead of rows) {
    const sources = (lead.enrichmentSources ?? {}) as Record<string, unknown>
    const jobOpts = { removeOnComplete: 200, removeOnFail: 500 }
    /** Only auto-queue once per lead; retries need `force` on enrichLeadFromTwogisSearch (e.g. script/API). */
    if (
      lead.name?.trim() &&
      lead.source !== '2gis' &&
      lead.source !== '2gis-extension' &&
      sources.twogisSearch == null
    ) {
      await twogisEnrichQueue.add(
        'enrich',
        { leadId: lead.id },
        { ...jobOpts, jobId: `twogis-${lead.id}` }
      )
    }

    if (lead.website && !sources.website) {
      await websiteEnrichQueue.add(
        'enrich',
        { leadId: lead.id, website: lead.website },
        { ...jobOpts, jobId: `web-${lead.id}` }
      )
    }

    if (lead.bin && !sources.stat) {
      await statEnrichQueue.add(
        'enrich',
        { leadId: lead.id, bin: lead.bin },
        { ...jobOpts, jobId: `stat-${lead.id}` }
      )
    }

    if (lead.bin && !sources.uchet) {
      await uchetEnrichQueue.add(
        'enrich',
        { leadId: lead.id, bin: lead.bin },
        { ...jobOpts, jobId: `uchet-${lead.id}` }
      )
    }

    if (lead.bin && !sources.goszakup) {
      await goszakupEnrichQueue.add(
        'enrich',
        { leadId: lead.id, bin: lead.bin },
        { ...jobOpts, jobId: `gzk-${lead.id}` }
      )
    }
  }

  console.log(`[enqueue] Enrichment jobs dispatched for ${rows.length} leads`)
}

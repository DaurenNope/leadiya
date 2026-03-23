import { Queue } from 'bullmq'
import { env } from '@leadiya/config'

const connection = { url: env.REDIS_URL }

// Queue definitions
export const discoveryQueue = new Queue('discovery', { connection })
export const enrichmentQueue = new Queue('enrichment', { connection })

// Per-source enrichment queues for independent concurrency
export const websiteEnrichQueue = new Queue('enrich-website', { connection })
export const statEnrichQueue = new Queue('enrich-stat', { connection })
export const uchetEnrichQueue = new Queue('enrich-uchet', { connection })
export const goszakupEnrichQueue = new Queue('enrich-goszakup', { connection })
export const twogisEnrichQueue = new Queue('enrich-twogis', { connection })

// Job types
export type DiscoveryJob = { city: string; category: string }
export type EnrichmentJob = { companyId: string; bin: string }
export type QualificationJob = { companyId: string }

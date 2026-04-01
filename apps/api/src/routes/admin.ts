import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types.js'
import {
  pingPostgres,
  pingRedis,
  getMergedWaStatus,
  getWhatsappQueueSnapshot,
  removeWhatsappDelayedJobs,
  removeWhatsappFailedJobs,
  resetWhatsappOutboundRateKeys,
  getOperationsSummarySync,
  getDiscoveryIntelligenceSnapshot,
} from '../lib/admin-operations.js'

const adminRouter = new Hono<AppEnv>()

/** Ops / control center: health, WhatsApp queue, failed-job hygiene (authenticated dashboard users). */
adminRouter.get('/summary', async (c) => {
  const tenant = c.get('tenant') as { id: string } | null
  const [pg, redis, wa, envFlags] = await Promise.all([
    pingPostgres(),
    pingRedis(),
    getMergedWaStatus(tenant?.id),
    Promise.resolve(getOperationsSummarySync()),
  ])
  const queue = await getWhatsappQueueSnapshot(25)
  const discovery = await getDiscoveryIntelligenceSnapshot(25)

  return c.json({
    postgres: pg,
    redis,
    whatsapp: wa,
    env: envFlags,
    whatsappQueue: {
      counts: queue.counts,
      failedSample: queue.failed,
    },
    discovery,
    hints: {
      delayedMeans:
        'delayed>0: jobs scheduled for later (business hours, hour/day caps, or min gap — see worker logs).',
      failedMeans:
        'failed jobs: inspect reason; remove stale failures after fixing workers/env. stdout logs are not stored here yet.',
      discoveryMeans:
        'Discovery intelligence tracks per-slice staleness/cooldown and adapts crawl depth. Higher staleRuns => longer backoff + shallower crawl.',
    },
  })
})

adminRouter.get('/discovery/intelligence', async (c) => {
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') ?? '40', 10) || 40))
  const snap = await getDiscoveryIntelligenceSnapshot(limit)
  return c.json(snap)
})

adminRouter.get('/queues/whatsapp', async (c) => {
  const limit = Math.min(80, Math.max(1, parseInt(c.req.query('failedLimit') ?? '40', 10) || 40))
  const snap = await getWhatsappQueueSnapshot(limit)
  return c.json(snap)
})

const removeFailedSchema = z.object({
  all: z.boolean().optional(),
  ids: z.array(z.string()).optional(),
})

adminRouter.post('/queues/whatsapp/failed/remove', async (c) => {
  const parsed = removeFailedSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', details: parsed.error.format() }, 400)
  }
  const { all, ids } = parsed.data
  if (all) {
    const r = await removeWhatsappFailedJobs('all')
    return c.json(r)
  }
  if (ids?.length) {
    const r = await removeWhatsappFailedJobs({ ids })
    return c.json(r)
  }
  return c.json({ error: 'Set all: true or ids: ["…"]', code: 'VALIDATION_ERROR' }, 400)
})

const removeDelayedSchema = z.object({
  all: z.boolean().optional(),
  ids: z.array(z.string()).optional(),
  /** Also delete `wa:rate:*` keys so hour/day caps restart (use after test floods). */
  resetOutboundRateKeys: z.boolean().optional(),
})

adminRouter.post('/queues/whatsapp/delayed/remove', async (c) => {
  const parsed = removeDelayedSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', details: parsed.error.format() }, 400)
  }
  const { all, ids, resetOutboundRateKeys } = parsed.data
  let removed = { removed: 0 }
  if (all) {
    removed = await removeWhatsappDelayedJobs('all')
  } else if (ids?.length) {
    removed = await removeWhatsappDelayedJobs({ ids })
  } else {
    return c.json({ error: 'Set all: true or ids: ["…"]', code: 'VALIDATION_ERROR' }, 400)
  }
  let rateKeysDeleted: number | undefined
  if (resetOutboundRateKeys) {
    const r = await resetWhatsappOutboundRateKeys()
    rateKeysDeleted = r.deleted
  }
  return c.json({ ...removed, rateKeysDeleted })
})

export { adminRouter }

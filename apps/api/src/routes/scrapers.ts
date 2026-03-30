import { Hono } from 'hono'
import { run2GisScraper } from '@leadiya/scrapers'
import { db, scraperRuns, leads } from '@leadiya/db'
import { desc, eq, and, sql } from 'drizzle-orm'
import { Queue } from 'bullmq'
import { z } from 'zod'
import { env } from '@leadiya/config'
import type { AppEnv } from '../types.js'

const scrapersRouter = new Hono<AppEnv>()

const enrichmentQueue = new Queue('enrichment', { connection: { url: env.REDIS_URL } })

const runsCacheTtlMs = env.SCRAPER_RUNS_CACHE_MS ?? 8_000
let runsCache: { key: string; at: number; body: { runs: unknown[] } } | null = null

scrapersRouter.get('/runs', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20', 10), 1), 100)
  const scraperFilter = c.req.query('scraper')
  const cacheKey = `${limit}:${scraperFilter ?? ''}`
  const now = Date.now()
  const skipCache = c.req.query('nocache') === '1'

  if (!skipCache && runsCacheTtlMs > 0 && runsCache && runsCache.key === cacheKey && now - runsCache.at < runsCacheTtlMs) {
    return c.json(runsCache.body)
  }

  const rows = scraperFilter
    ? await db
        .select()
        .from(scraperRuns)
        .where(eq(scraperRuns.scraper, scraperFilter))
        .orderBy(desc(scraperRuns.startedAt))
        .limit(limit)
    : await db
        .select()
        .from(scraperRuns)
        .orderBy(desc(scraperRuns.startedAt))
        .limit(limit)

  const body = { runs: rows }
  if (runsCacheTtlMs > 0) {
    runsCache = { key: cacheKey, at: now, body }
  }
  return c.json(body)
})

scrapersRouter.get('/runs/:id', async (c) => {
  const id = c.req.param('id')
  const [run] = await db
    .select()
    .from(scraperRuns)
    .where(eq(scraperRuns.id, id))
    .limit(1)

  if (!run) return c.json({ error: 'Run not found', code: 'NOT_FOUND' }, 404)
  return c.json(run)
})

/** Mark a run as cancelled so the in-process Crawlee worker stops between slices (cooperative). */
scrapersRouter.post('/runs/:id/cancel', async (c) => {
  const id = c.req.param('id')
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidRe.test(id)) {
    return c.json({ error: 'Invalid run id', code: 'VALIDATION_ERROR' }, 400)
  }

  const [run] = await db.select().from(scraperRuns).where(eq(scraperRuns.id, id)).limit(1)
  if (!run) return c.json({ error: 'Run not found', code: 'NOT_FOUND' }, 404)

  const st = run.status.toLowerCase()
  if (st !== 'running') {
    return c.json(
      { error: `Run is not running (status: ${run.status})`, code: 'NOT_RUNNING', status: run.status },
      409
    )
  }

  await db
    .update(scraperRuns)
    .set({
      status: 'cancelled',
      error: 'Stopped from dashboard (POST /api/scrapers/runs/:id/cancel)',
      completedAt: new Date(),
      resultsCount: run.resultsCount ?? '0',
    })
    .where(eq(scraperRuns.id, id))

  return c.json({ ok: true, id, status: 'cancelled' })
})

const scrapeSchema = z.object({
  cities: z.array(z.string().min(1).max(120)).min(1).max(30),
  categories: z.array(z.string().min(1).max(120)).min(1).max(80),
  headless: z.boolean().optional().default(true),
  listStrategy: z.enum(['dom', 'network', 'hybrid']).optional().default('hybrid'),
  maxConcurrency: z.number().int().min(1).max(10).optional(),
  /** Default false so API/UI matches CLI scripts (fresh slice). Pass true to resume after crashes. */
  resumeCheckpoint: z.boolean().optional().default(false),
  checkpointDirectory: z.string().optional(),
  /** Optional caps for smoke tests (same as CLI); omit for full production runs. */
  limits: z
    .object({
      maxListPages: z.number().int().min(1).max(500).optional(),
      maxFirmDetailAttempts: z.number().int().min(1).max(50_000).optional(),
    })
    .optional(),
  /** When true, ignore SMARTPROXY_* (direct egress — use for local/dev if proxy wedges 2GIS). */
  skipProxy: z.boolean().optional().default(false),
})

scrapersRouter.post('/2gis', async (c) => {
  const body = await c.req.json()
  const result = scrapeSchema.safeParse(body)

  if (!result.success) {
    return c.json({ error: 'Invalid parameters', code: 'VALIDATION_ERROR', details: result.error.format() }, 400)
  }

  const {
    cities,
    categories,
    headless,
    listStrategy,
    maxConcurrency,
    resumeCheckpoint,
    checkpointDirectory,
    limits,
    skipProxy,
  } = result.data

  const [existing] = await db
    .select({ id: scraperRuns.id })
    .from(scraperRuns)
    .where(and(eq(scraperRuns.scraper, '2gis'), eq(scraperRuns.status, 'running')))
    .orderBy(desc(scraperRuns.startedAt))
    .limit(1)

  if (existing) {
    return c.json({ runId: existing.id, message: 'Scraper already running', existing: true }, 202)
  }

  const totalSlices = cities.length * categories.length
  const [row] = await db
    .insert(scraperRuns)
    .values({ scraper: '2gis', status: 'running', lastProgressAt: new Date(), totalSlices })
    .returning({ id: scraperRuns.id })

  const runId = row.id

  run2GisScraper({
    cities,
    categories,
    headless,
    listStrategy,
    maxConcurrency,
    resumeCheckpoint,
    checkpointDirectory,
    limits,
    skipProxy,
    scraperRunId: runId,
  }).then(
    async (res) => {
      const [current] = await db.select({ status: scraperRuns.status }).from(scraperRuns).where(eq(scraperRuns.id, runId)).limit(1)
      if (current?.status?.toLowerCase() === 'cancelled') return

      if (res.leadIds.length > 0) {
        await enrichmentQueue.add('enrich', { leadIds: res.leadIds }, {
          // BullMQ jobId cannot contain ':' (it validates customId); keep stable + unique.
          jobId: `enrich-discovery-${runId}`,
          removeOnComplete: 200,
          removeOnFail: 500,
        })
        console.log(`[api:2gis] Queued enrichment for ${res.leadIds.length} new leads from run ${runId}`)
      }
    },
    async (err) => {
      const [current] = await db.select({ status: scraperRuns.status }).from(scraperRuns).where(eq(scraperRuns.id, runId)).limit(1)
      if (current?.status?.toLowerCase() === 'cancelled') return

      await db
        .update(scraperRuns)
        .set({ status: 'error', error: err instanceof Error ? err.message : String(err), completedAt: new Date() })
        .where(eq(scraperRuns.id, runId))
        .catch(() => {})
    }
  )

  return c.json({ runId, message: 'Scraper job started' }, 202)
})

scrapersRouter.post('/re-enrich', async (c) => {
  const stale = await db
    .select({ id: leads.id })
    .from(leads)
    .where(sql`${leads.lastEnrichedAt} IS NULL OR ${leads.lastEnrichedAt} < NOW() - INTERVAL '30 days'`)
    .limit(500)

  if (stale.length === 0) {
    return c.json({ message: 'No stale leads found', count: 0 })
  }

  const ids = stale.map((r) => r.id)
  await enrichmentQueue.add('enrich', { leadIds: ids }, {
    // BullMQ jobId cannot contain ':'.
    jobId: `re-enrich-${Date.now()}`,
    removeOnComplete: 200,
    removeOnFail: 500,
  })

  return c.json({ message: `Queued ${ids.length} leads for re-enrichment`, count: ids.length }, 202)
})

scrapersRouter.get('/stats', async (c) => {
  const [totalLeads] = await db.select({ count: sql<number>`count(*)` }).from(leads)
  const [enriched] = await db
    .select({ count: sql<number>`count(*)` })
    .from(leads)
    .where(sql`${leads.lastEnrichedAt} IS NOT NULL`)
  const [running] = await db
    .select({ count: sql<number>`count(*)` })
    .from(scraperRuns)
    .where(eq(scraperRuns.status, 'running'))

  return c.json({
    totalLeads: Number(totalLeads.count),
    enrichedLeads: Number(enriched.count),
    runningJobs: Number(running.count),
  })
})

export { scrapersRouter }

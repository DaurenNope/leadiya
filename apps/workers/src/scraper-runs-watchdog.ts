import cron from 'node-cron'
import { and, eq, lt, sql } from 'drizzle-orm'
import { env } from '@leadiya/config'
import { db, scraperRuns } from '@leadiya/db'

const staleHours = env.SCRAPER_RUN_STALE_AFTER_HOURS ?? 6
const noProgressMinutes = env.SCRAPER_RUN_NO_PROGRESS_MINUTES ?? 30

/**
 * Closes scraper_runs left in `running` (e.g. API crash, OOM, killed process) so the dashboard
 * and single-flight lock recover without manual SQL. See docs/progress/DATA_COLLECTION_100K_PLAN.md §10.
 */
cron.schedule('*/30 * * * *', async () => {
  const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000)

  try {
    const closed = await db
      .update(scraperRuns)
      .set({
        status: 'error',
        error: `Stale run: remained "running" for more than ${staleHours}h (worker watchdog)`,
        completedAt: new Date(),
      })
      .where(and(eq(scraperRuns.status, 'running'), lt(scraperRuns.startedAt, cutoff)))
      .returning({ id: scraperRuns.id })

    if (closed.length > 0) {
      console.warn(
        `[scraper-runs-watchdog] Marked ${closed.length} stale run(s) as error (>${staleHours}h in running)`,
      )
    }
  } catch (e) {
    console.error('[scraper-runs-watchdog]', e instanceof Error ? e.message : e)
  }
})

/**
 * Runs that are still `running` but have not advanced list pages / stats / saves for N minutes
 * (captcha, proxy wedge, navigation hang before timeout).
 */
cron.schedule('*/5 * * * *', async () => {
  const cutoff = new Date(Date.now() - noProgressMinutes * 60 * 1000)

  try {
    const closed = await db
      .update(scraperRuns)
      .set({
        status: 'error',
        error: `No progress for ${noProgressMinutes}+ minutes (last_progress_at / heartbeat; worker watchdog). Check API logs — often captcha, proxy, or 2GIS blocking.`,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(scraperRuns.status, 'running'),
          sql`COALESCE(${scraperRuns.lastProgressAt}, ${scraperRuns.startedAt}) < ${cutoff}`,
        ),
      )
      .returning({ id: scraperRuns.id })

    if (closed.length > 0) {
      console.warn(
        `[scraper-runs-watchdog] Marked ${closed.length} run(s) as error (no progress >${noProgressMinutes}m)`,
      )
    }
  } catch (e) {
    console.error('[scraper-runs-watchdog:no-progress]', e instanceof Error ? e.message : e)
  }
})

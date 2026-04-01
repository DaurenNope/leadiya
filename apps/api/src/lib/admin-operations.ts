import { Redis } from 'ioredis'
import { Queue } from 'bullmq'
import { env, isWhatsappBusinessHoursDisabled } from '@leadiya/config'
import { db, sql } from '@leadiya/db'
import type { WhatsAppOutreachJobData } from '@leadiya/queue'

function isBaileysSendEnabled(): boolean {
  const v = env.WHATSAPP_BAILEYS_ENABLED?.trim()
  return v === 'true' || v === '1'
}

export async function pingPostgres(): Promise<{ ok: boolean; error?: string }> {
  try {
    await db.execute(sql`select 1`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function pingRedis(): Promise<{ ok: boolean; error?: string }> {
  const r = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 5000, lazyConnect: true })
  try {
    await r.connect()
    const pong = await r.ping()
    await r.quit()
    if (pong !== 'PONG') return { ok: false, error: `unexpected: ${pong}` }
    return { ok: true }
  } catch (e) {
    try {
      await r.quit()
    } catch {
      /* */
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Merged WA status for JWT tenant + DEFAULT_TENANT_ID (same logic as GET /api/outreach/whatsapp/status). */
export async function getMergedWaStatus(jwtTenantId?: string | null): Promise<{
  status: string
  updatedAt: number | null
  baileysSendEnabled: boolean
}> {
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true })
  await redis.connect()

  const defaultTid = process.env.DEFAULT_TENANT_ID?.trim()
  const candidateIds = [...new Set([jwtTenantId, defaultTid].filter((x): x is string => Boolean(x)))]

  const rank: Record<string, number> = {
    connected: 5,
    waiting_qr: 4,
    reconnecting: 3,
    disconnected: 2,
    unknown: 1,
  }

  let bestParsed: { status: string; updatedAt: number } | null = null
  let bestScore = -1

  for (const id of candidateIds) {
    const statusRaw = await redis.get(`wa:status:${id}`)
    if (!statusRaw) continue
    const parsed = JSON.parse(statusRaw) as { status: string; updatedAt: number }
    const score = rank[parsed.status] ?? 0
    if (score > bestScore) {
      bestScore = score
      bestParsed = parsed
    } else if (score === bestScore && bestParsed && parsed.updatedAt > bestParsed.updatedAt) {
      bestParsed = parsed
    }
  }

  if (!bestParsed && candidateIds.length === 0) {
    const legacyRaw = await redis.get('wa:connection:status')
    if (legacyRaw) {
      try {
        bestParsed = JSON.parse(legacyRaw) as { status: string; updatedAt: number }
      } catch {
        /* */
      }
    }
  }

  await redis.quit()

  return {
    status: bestParsed?.status ?? 'unknown',
    updatedAt: bestParsed?.updatedAt ?? null,
    baileysSendEnabled: isBaileysSendEnabled(),
  }
}

export type WhatsappFailedJobRow = {
  id: string
  finishedOn: string | null
  attemptsMade: number
  failedReason: string
  tenantId?: string
  leadId?: string
  phoneDigits?: string
  bodyPreview: string
}

export async function getWhatsappQueueSnapshot(limitFailed = 40): Promise<{
  counts: Record<string, number>
  failed: WhatsappFailedJobRow[]
}> {
  const q = new Queue<WhatsAppOutreachJobData>('whatsapp_outreach', {
    connection: { url: env.REDIS_URL },
  })
  try {
    const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'paused')
    const failedJobs = await q.getJobs(['failed'], 0, limitFailed - 1, false)
    const failed: WhatsappFailedJobRow[] = failedJobs.map((j) => {
      const d = j.data
      const body = d.body ?? ''
      return {
        id: String(j.id),
        finishedOn: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
        attemptsMade: j.attemptsMade,
        failedReason: (j.failedReason ?? '').trim() || '(no reason)',
        tenantId: d.tenantId,
        leadId: d.leadId,
        phoneDigits: d.phoneDigits,
        bodyPreview: body.length > 160 ? `${body.slice(0, 160)}…` : body,
      }
    })
    return {
      counts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
        paused: counts.paused ?? 0,
      },
      failed,
    }
  } finally {
    await q.close()
  }
}

export async function removeWhatsappDelayedJobs(mode: 'all' | { ids: string[] }): Promise<{ removed: number }> {
  const q = new Queue<WhatsAppOutreachJobData>('whatsapp_outreach', {
    connection: { url: env.REDIS_URL },
  })
  try {
    let removed = 0
    if (mode === 'all') {
      const jobs = await q.getJobs(['delayed'], 0, 999, false)
      for (const j of jobs) {
        try {
          await j.remove()
          removed++
        } catch {
          /* race */
        }
      }
    } else {
      for (const id of mode.ids) {
        const job = await q.getJob(id)
        if (!job) continue
        try {
          await job.remove()
          removed++
        } catch {
          /* */
        }
      }
    }
    return { removed }
  } finally {
    await q.close()
  }
}

/** Deletes Redis keys `wa:rate:*` used by whatsapp-baileys.worker hour/day caps (dev recovery after floods). */
export async function resetWhatsappOutboundRateKeys(): Promise<{ deleted: number }> {
  const r = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 5000, lazyConnect: true })
  try {
    await r.connect()
    let cursor = '0'
    let deleted = 0
    do {
      const [next, keys] = await r.scan(cursor, 'MATCH', 'wa:rate:*', 'COUNT', 200)
      cursor = next
      if (keys.length > 0) {
        deleted += await r.del(...keys)
      }
    } while (cursor !== '0')
    return { deleted }
  } finally {
    try {
      await r.quit()
    } catch {
      /* */
    }
  }
}

export async function removeWhatsappFailedJobs(mode: 'all' | { ids: string[] }): Promise<{ removed: number }> {
  const q = new Queue<WhatsAppOutreachJobData>('whatsapp_outreach', {
    connection: { url: env.REDIS_URL },
  })
  try {
    let removed = 0
    if (mode === 'all') {
      const jobs = await q.getJobs(['failed'], 0, 499, false)
      for (const j of jobs) {
        try {
          await j.remove()
          removed++
        } catch {
          /* race */
        }
      }
    } else {
      for (const id of mode.ids) {
        const job = await q.getJob(id)
        if (!job) continue
        try {
          await job.remove()
          removed++
        } catch {
          /* */
        }
      }
    }
    return { removed }
  } finally {
    await q.close()
  }
}

export function getOperationsSummarySync(): {
  nodeEnv: string
  businessHoursDeferralOff: boolean
  defaultTenantConfigured: boolean
} {
  return {
    nodeEnv: env.NODE_ENV,
    businessHoursDeferralOff: isWhatsappBusinessHoursDisabled(),
    defaultTenantConfigured: Boolean(process.env.DEFAULT_TENANT_ID?.trim()),
  }
}

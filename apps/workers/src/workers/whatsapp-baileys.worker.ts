import { Worker, type Job } from 'bullmq'
import { QueueName, connection, type WhatsAppOutreachJobData } from '@leadiya/queue'
import {
  waRedis,
  sendMessage,
  initLegacyConnection,
  setInboundHandler,
} from '../lib/whatsapp-pool.js'
import { handleInboundReply } from './sequence-engine.js'

setInboundHandler(handleInboundReply)

initLegacyConnection()

const BH_TZ = process.env.WHATSAPP_BUSINESS_HOURS_TZ ?? 'Asia/Almaty'
const BH_START = Number(process.env.WHATSAPP_BUSINESS_HOURS_START ?? '9')
const BH_END = Number(process.env.WHATSAPP_BUSINESS_HOURS_END ?? '19')

function hourInTz(date: Date, tz: string): number {
  try {
    const s = date.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false })
    return parseInt(s, 10)
  } catch {
    return date.getHours()
  }
}

/** Next time (within ~36h) when local hour is in [startH, endH). */
function msUntilBusinessWindow(tz: string, startH: number, endH: number): number {
  const stepMs = 60_000
  const maxMs = 36 * 3600 * 1000
  for (let ms = 0; ms <= maxMs; ms += stepMs) {
    const d = new Date(Date.now() + ms)
    const h = hourInTz(d, tz)
    if (h >= startH && h < endH) return ms
  }
  return 3600_000
}

const whatsappWorker = new Worker<WhatsAppOutreachJobData>(
  QueueName.WHATSAPP_OUTREACH,
  async (job: Job<WhatsAppOutreachJobData>) => {
    const { leadId, phoneDigits, body, tenantId, outreachLogStatus } = job.data
    const jid = `${phoneDigits}@s.whatsapp.net`

    const effectiveTenantId = tenantId || process.env.DEFAULT_TENANT_ID
    if (!effectiveTenantId) {
      throw new Error('No tenantId in job data and no DEFAULT_TENANT_ID configured')
    }

    const hour = hourInTz(new Date(), BH_TZ)
    if (hour < BH_START || hour >= BH_END) {
      const delayMs = msUntilBusinessWindow(BH_TZ, BH_START, BH_END)
      console.log(
        `[whatsapp] Outside business hours (${hour}h, window ${BH_START}–${BH_END} ${BH_TZ}) — moveToDelayed ${Math.round(delayMs / 60000)}min`,
      )
      await job.moveToDelayed(Date.now() + delayMs)
      return { deferred: 'business_hours' as const, delayMs }
    }

    const hourKey = `wa:rate:h:${effectiveTenantId}:${new Date().toISOString().slice(0, 13)}`
    const dayKey = `wa:rate:d:${effectiveTenantId}:${new Date().toISOString().slice(0, 10)}`

    const hourCount = await waRedis.incr(hourKey)
    if (hourCount === 1) await waRedis.expire(hourKey, 7200)
    const dayCount = await waRedis.incr(dayKey)
    if (dayCount === 1) await waRedis.expire(dayKey, 172800)

    if (hourCount > 10) {
      await waRedis.decr(hourKey)
      await waRedis.decr(dayKey)
      const delayMs = 3600_000
      console.log('[whatsapp] Hour rate limit — moveToDelayed 60m')
      await job.moveToDelayed(Date.now() + delayMs)
      return { deferred: 'hour_rate' as const }
    }
    if (dayCount > 30) {
      await waRedis.decr(hourKey)
      await waRedis.decr(dayKey)
      const delayMs = 24 * 3600_000
      console.log('[whatsapp] Day rate limit — moveToDelayed 24h')
      await job.moveToDelayed(Date.now() + delayMs)
      return { deferred: 'day_rate' as const }
    }

    const lastTs = await waRedis.get(`wa:outreach:last_ts:${effectiveTenantId}`)
    const minDelay = 35_000 + Math.random() * 55_000
    if (lastTs) {
      const elapsed = Date.now() - Number(lastTs)
      if (elapsed < minDelay) {
        await new Promise((r) => setTimeout(r, minDelay - elapsed))
      }
    }

    await sendMessage(effectiveTenantId, jid, body, leadId, {
      logStatus: outreachLogStatus,
    })
    await waRedis.set(`wa:outreach:last_ts:${effectiveTenantId}`, String(Date.now()))

    return { ok: true, jid }
  },
  {
    connection,
    concurrency: 1,
    /** No BullMQ limiter — it can leave `bull:whatsapp_outreach:limiter` stuck and block all jobs. Rate limits are in-handler (Redis + min delay + business hours). */
  },
)

whatsappWorker.on('ready', () => {
  console.log('[whatsapp] BullMQ worker connected to Redis — consuming whatsapp_outreach')
})

whatsappWorker.on('completed', (job) => {
  console.log(`[whatsapp] sent job ${job.id}`)
})

whatsappWorker.on('failed', (job, err) => {
  console.error(`[whatsapp] job ${job?.id} failed:`, err?.message)
})

console.log('[whatsapp] Baileys outbound worker registered (queue: whatsapp_outreach)')

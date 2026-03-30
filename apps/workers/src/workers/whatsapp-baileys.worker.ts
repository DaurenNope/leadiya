import { Worker } from 'bullmq'
import { env } from '@leadiya/config'
import { QueueName, type WhatsAppOutreachJobData } from '@leadiya/queue'
import {
  waRedis,
  sendMessage,
  ensureConnected,
  initLegacyConnection,
  setInboundHandler,
} from '../lib/whatsapp-pool.js'
import { handleInboundReply } from './sequence-engine.js'

setInboundHandler(handleInboundReply)

initLegacyConnection()

function currentHourInTz(tz: string): number {
  try {
    const s = new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false })
    return parseInt(s, 10)
  } catch {
    return new Date().getHours()
  }
}

const whatsappWorker = new Worker<WhatsAppOutreachJobData>(
  QueueName.WHATSAPP_OUTREACH,
  async (job) => {
    const { leadId, phoneDigits, body, tenantId } = job.data as WhatsAppOutreachJobData & { tenantId?: string }
    const jid = `${phoneDigits}@s.whatsapp.net`

    const effectiveTenantId = tenantId || process.env.DEFAULT_TENANT_ID
    if (!effectiveTenantId) {
      throw new Error('No tenantId in job data and no DEFAULT_TENANT_ID configured')
    }

    const hour = currentHourInTz('Asia/Almaty')
    if (hour < 9 || hour >= 19) {
      const hoursUntil = hour < 9 ? (9 - hour) : (24 - hour + 9)
      const delayMs = hoursUntil * 3_600_000 + (60 - new Date().getMinutes()) * 60_000
      console.log(`[whatsapp] Outside business hours (${hour}h) — re-queuing with ${Math.round(delayMs / 60000)}min delay`)
      await whatsappWorker.rateLimit(delayMs)
      throw Worker.RateLimitError()
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
      throw new Error('WHATSAPP_RATE_LIMIT_HOUR')
    }
    if (dayCount > 30) {
      await waRedis.decr(hourKey)
      await waRedis.decr(dayKey)
      throw new Error('WHATSAPP_RATE_LIMIT_DAY')
    }

    const lastTs = await waRedis.get(`wa:outreach:last_ts:${effectiveTenantId}`)
    const minDelay = 35_000 + Math.random() * 55_000
    if (lastTs) {
      const elapsed = Date.now() - Number(lastTs)
      if (elapsed < minDelay) {
        await new Promise((r) => setTimeout(r, minDelay - elapsed))
      }
    }

    await sendMessage(effectiveTenantId, jid, body, leadId)
    await waRedis.set(`wa:outreach:last_ts:${effectiveTenantId}`, String(Date.now()))

    return { ok: true, jid }
  },
  {
    connection: { url: env.REDIS_URL },
    concurrency: 1,
    limiter: { max: 1, duration: 5000 },
  },
)

whatsappWorker.on('completed', (job) => {
  console.log(`[whatsapp] sent job ${job.id}`)
})

whatsappWorker.on('failed', (job, err) => {
  console.error(`[whatsapp] job ${job?.id} failed:`, err?.message)
})

console.log('[whatsapp] Baileys outbound worker registered (queue: whatsapp_outreach)')

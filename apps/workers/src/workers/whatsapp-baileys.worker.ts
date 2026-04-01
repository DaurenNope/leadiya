import { DelayedError, Worker, type Job } from 'bullmq'
import { QueueName, connection, type WhatsAppOutreachJobData } from '@leadiya/queue'
import { env, isWhatsappBusinessHoursDisabled } from '@leadiya/config'
import {
  waRedis,
  sendMessage,
  initLegacyConnection,
  setInboundHandler,
} from '../lib/whatsapp-pool.js'
import { handleInboundReply } from './sequence-engine.js'
import { logWaAgent } from '../lib/wa-agent-log.js'
import { shouldSuppressSequenceSend } from '../lib/sequence-send-guard.js'
import {
  hourInTz,
  isOutsideBusinessWindow,
  msUntilBusinessWindow,
} from '../lib/whatsapp-business-hours.js'

setInboundHandler(handleInboundReply)

initLegacyConnection()

const bhOff = isWhatsappBusinessHoursDisabled()
console.log(
  `[whatsapp] Business-hours deferral: ${bhOff ? 'OFF' : 'ON'} (Asia/Almaty 9–19). ` +
    (bhOff
      ? 'Sends are not blocked by clock.'
      : `Unset WHATSAPP_BUSINESS_HOURS_DISABLED with NODE_ENV=${env.NODE_ENV} — set WHATSAPP_BUSINESS_HOURS_DISABLED=1 to disable, or use NODE_ENV=development locally.`),
)

const BH_TZ = process.env.WHATSAPP_BUSINESS_HOURS_TZ ?? 'Asia/Almaty'
const BH_START = Number(process.env.WHATSAPP_BUSINESS_HOURS_START ?? '9')
const BH_END = Number(process.env.WHATSAPP_BUSINESS_HOURS_END ?? '19')

const whatsappWorker = new Worker<WhatsAppOutreachJobData>(
  QueueName.WHATSAPP_OUTREACH,
  async (job: Job<WhatsAppOutreachJobData>, token?: string) => {
    const { leadId, phoneDigits, body, tenantId, outreachLogStatus, sequenceKey } = job.data
    const jid = `${phoneDigits}@s.whatsapp.net`

    const effectiveTenantId = tenantId || process.env.DEFAULT_TENANT_ID
    if (!effectiveTenantId) {
      throw new Error('No tenantId in job data and no DEFAULT_TENANT_ID configured')
    }

    const hour = hourInTz(new Date(), BH_TZ)
    if (!isWhatsappBusinessHoursDisabled() && isOutsideBusinessWindow(hour, BH_START, BH_END)) {
      const delayMs = msUntilBusinessWindow(BH_TZ, BH_START, BH_END)
      console.log(
        `[whatsapp] Outside business hours (${hour}h, window ${BH_START}–${BH_END} ${BH_TZ}) — moveToDelayed ${Math.round(delayMs / 60000)}min (job ${job.id})`,
      )
      logWaAgent({
        component: 'whatsapp-worker',
        action: 'deferred',
        deferralReason: 'business_hours',
        jobId: job.id,
        leadId: leadId ?? undefined,
        tenantId: effectiveTenantId,
        detail: `outside_window_${BH_TZ}_${BH_START}-${BH_END}h_delayMs=${delayMs}`,
      })
      await job.moveToDelayed(Date.now() + delayMs, token)
      throw new DelayedError()
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
      console.log(`[whatsapp] Hour rate limit — moveToDelayed 60m (job ${job.id})`)
      logWaAgent({
        component: 'whatsapp-worker',
        action: 'deferred',
        deferralReason: 'hour_cap',
        jobId: job.id,
        leadId: leadId ?? undefined,
        tenantId: effectiveTenantId,
        detail: `delayMs=${delayMs}`,
      })
      await job.moveToDelayed(Date.now() + delayMs, token)
      throw new DelayedError()
    }
    if (dayCount > 30) {
      await waRedis.decr(hourKey)
      await waRedis.decr(dayKey)
      const delayMs = 24 * 3600_000
      console.log(`[whatsapp] Day rate limit — moveToDelayed 24h (job ${job.id})`)
      logWaAgent({
        component: 'whatsapp-worker',
        action: 'deferred',
        deferralReason: 'day_cap',
        jobId: job.id,
        leadId: leadId ?? undefined,
        tenantId: effectiveTenantId,
        detail: `delayMs=${delayMs}`,
      })
      await job.moveToDelayed(Date.now() + delayMs, token)
      throw new DelayedError()
    }

    const lastTs = await waRedis.get(`wa:outreach:last_ts:${effectiveTenantId}`)
    const gapMin = env.WHATSAPP_MIN_SEND_GAP_MS ?? 35_000
    const gapJitter = env.WHATSAPP_MAX_SEND_GAP_JITTER_MS ?? 55_000
    const minDelay = gapMin + (gapJitter > 0 ? Math.random() * gapJitter : 0)
    if (lastTs && minDelay > 0) {
      const elapsed = Date.now() - Number(lastTs)
      if (elapsed < minDelay) {
        await new Promise((r) => setTimeout(r, minDelay - elapsed))
      }
    }

    if (await shouldSuppressSequenceSend(leadId, sequenceKey)) {
      await waRedis.decr(hourKey)
      await waRedis.decr(dayKey)
      logWaAgent({
        component: 'whatsapp-worker',
        action: 'skipped',
        reason: 'sequence_not_active',
        jobId: job.id,
        leadId: leadId ?? undefined,
        tenantId: effectiveTenantId,
      })
      console.log(`[whatsapp] skip job ${job.id}: sequence no longer active for lead ${leadId}`)
      return { ok: true, skipped: true }
    }

    await sendMessage(effectiveTenantId, jid, body, leadId, {
      logStatus: outreachLogStatus,
    })
    await waRedis.set(`wa:outreach:last_ts:${effectiveTenantId}`, String(Date.now()))

    logWaAgent({
      component: 'whatsapp-worker',
      action: 'sent',
      jobId: job.id,
      leadId: leadId ?? undefined,
      tenantId: effectiveTenantId,
    })

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

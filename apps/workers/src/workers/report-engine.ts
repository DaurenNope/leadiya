import cron from 'node-cron'
import { db, leads, outreachLog, leadSequenceState, eq, sql, and, desc } from '@leadiya/db'
import { whatsappOutreachQueue } from '@leadiya/queue'
import { withCronLock } from '../lib/cron-lock.js'
import { getReportBrand } from '../lib/worker-business-config.js'
import {
  buildDailyDigestBody,
  buildWeeklySummaryBody,
  hotLeadsQuietLine,
} from '../lib/report-messages.js'

const FOUNDER_PHONE = () => process.env.FOUNDER_WHATSAPP?.replace(/\D/g, '') || null

cron.schedule('0 3 * * *', async () => {
  await withCronLock('report-daily', 900, async () => {
    try {
      await sendDailyDigest()
    } catch (err) {
      console.error('[report-engine] Daily digest error:', err)
    }
  })
})

async function sendDailyDigest() {
  const phone = FOUNDER_PHONE()
  if (!phone) return

  const brand = getReportBrand()
  const now = new Date()
  const yesterday = new Date(now.getTime() - 86_400_000)

  const [stats] = await db
    .select({
      totalSent: sql<number>`count(*) filter (where direction = 'outbound' and created_at >= ${yesterday})`,
      totalReceived: sql<number>`count(*) filter (where direction = 'inbound' and created_at >= ${yesterday})`,
    })
    .from(outreachLog)

  const [seqStats] = await db
    .select({
      active: sql<number>`count(*) filter (where status = 'active')`,
      completed: sql<number>`count(*) filter (where status = 'completed' and updated_at >= ${yesterday})`,
      cold: sql<number>`count(*) filter (where status = 'cold' and updated_at >= ${yesterday})`,
      positive: sql<number>`count(*) filter (where intent = 'positive' or intent = 'meeting' or intent = 'qualification')`,
    })
    .from(leadSequenceState)

  const hotLeads = await db
    .select({
      leadName: leads.name,
      leadCity: leads.city,
      intent: leadSequenceState.intent,
      qualificationData: leadSequenceState.qualificationData,
    })
    .from(leadSequenceState)
    .innerJoin(leads, eq(leadSequenceState.leadId, leads.id))
    .where(
      and(
        sql`${leadSequenceState.lastReplyAt} >= ${yesterday}`,
        sql`${leadSequenceState.intent} IN ('positive', 'meeting', 'pricing', 'qualification')`,
      ),
    )
    .orderBy(desc(leadSequenceState.lastReplyAt))
    .limit(10)

  const hotList =
    hotLeads.length > 0
      ? hotLeads
          .map((h, i) => {
            const icons: Record<string, string> = {
              positive: '🟢',
              meeting: '📅',
              pricing: '💰',
              qualification: '📋',
            }
            const qd = h.qualificationData as Record<string, unknown> | null
            const service = qd?.service ? ` — ${qd.service}` : ''
            return `${i + 1}. ${icons[h.intent] || '📨'} ${h.leadName || '?'} (${h.leadCity || '?'})${service}`
          })
          .join('\n')
      : hotLeadsQuietLine

  const briefs = hotLeads
    .filter((h) => {
      const qd = h.qualificationData as Record<string, unknown> | null
      return qd?.service && qd?.description
    })
    .map((h) => {
      const qd = h.qualificationData as Record<string, unknown>
      return `📋 ${h.leadName}: ${qd.service} — ${String(qd.description).slice(0, 100)}`
    })

  const briefsBlock = briefs.length > 0 ? briefs.join('\n') : ''

  const body = buildDailyDigestBody(
    brand,
    { totalSent: stats.totalSent, totalReceived: stats.totalReceived },
    seqStats,
    hotList,
    briefsBlock,
  )

  await whatsappOutreachQueue.add(
    'send',
    {
      phoneDigits: phone,
      body,
      tenantId: process.env.DEFAULT_TENANT_ID || undefined,
    },
    { removeOnComplete: true },
  )

  console.log('[report-engine] Daily digest sent to founder')
}

cron.schedule('0 4 * * 1', async () => {
  await withCronLock('report-weekly', 900, async () => {
    try {
      await sendWeeklySummary()
    } catch (err) {
      console.error('[report-engine] Weekly summary error:', err)
    }
  })
})

async function sendWeeklySummary() {
  const phone = FOUNDER_PHONE()
  if (!phone) return

  const brand = getReportBrand()
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)

  const [stats] = await db
    .select({
      sent: sql<number>`count(*) filter (where direction = 'outbound' and created_at >= ${weekAgo})`,
      received: sql<number>`count(*) filter (where direction = 'inbound' and created_at >= ${weekAgo})`,
    })
    .from(outreachLog)

  const [seqStats] = await db
    .select({
      started: sql<number>`count(*) filter (where started_at >= ${weekAgo})`,
      completed: sql<number>`count(*) filter (where status = 'completed' and updated_at >= ${weekAgo})`,
      cold: sql<number>`count(*) filter (where status = 'cold' and updated_at >= ${weekAgo})`,
    })
    .from(leadSequenceState)

  const [leadStats] = await db
    .select({
      total: sql<number>`count(*)`,
      thisWeek: sql<number>`count(*) filter (where created_at >= ${weekAgo})`,
    })
    .from(leads)

  const replyRate = stats.sent > 0 ? Math.round((stats.received / stats.sent) * 100) : 0
  const conversionPct =
    seqStats.started > 0 ? Math.round((seqStats.completed / seqStats.started) * 100) : 0

  const body = buildWeeklySummaryBody(
    brand,
    leadStats,
    stats,
    seqStats,
    replyRate,
    conversionPct,
  )

  await whatsappOutreachQueue.add(
    'send',
    {
      phoneDigits: phone,
      body,
      tenantId: process.env.DEFAULT_TENANT_ID || undefined,
    },
    { removeOnComplete: true },
  )

  console.log('[report-engine] Weekly summary sent')
}

console.log('[report-engine] Report engine loaded (daily 9am + weekly Mon 10am Almaty)')

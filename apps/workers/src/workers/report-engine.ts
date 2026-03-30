import cron from 'node-cron'
import { sql } from 'drizzle-orm'
import {
  db,
  leads,
  outreachLog,
  leadSequenceState,
  tenants,
  tenantLeads,
  eq,
  and,
  desc,
} from '@leadiya/db'
import { whatsappOutreachQueue } from '@leadiya/queue'
import { withCronLock } from '../lib/cron-lock.js'
import { getReportBrand } from '../lib/worker-business-config.js'
import {
  buildDailyDigestBody,
  buildWeeklySummaryBody,
  hotLeadsQuietLine,
} from '../lib/report-messages.js'

const FOUNDER_PHONE = () => process.env.FOUNDER_WHATSAPP?.replace(/\D/g, '') || null

type TenantRow = { id: string; name: string; slug: string }

async function listActiveTenants(): Promise<TenantRow[]> {
  return db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.active, true))
}

cron.schedule('0 3 * * *', async () => {
  await withCronLock('report-daily', 900, async () => {
    try {
      await runDailyDigests()
    } catch (err) {
      console.error('[report-engine] Daily digest error:', err)
    }
  })
})

async function runDailyDigests() {
  const phone = FOUNDER_PHONE()
  if (!phone) return

  const tenantRows = await listActiveTenants()
  if (tenantRows.length === 0) {
    await sendDailyDigest(null)
    return
  }
  for (const t of tenantRows) {
    await sendDailyDigest(t)
  }
}

async function sendDailyDigest(tenant: TenantRow | null) {
  const phone = FOUNDER_PHONE()
  if (!phone) return

  const brand = getReportBrand()
  const now = new Date()
  const yesterday = new Date(now.getTime() - 86_400_000)

  const outreachBase = db
    .select({
      totalSent: sql<number>`count(*) filter (where direction = 'outbound' and created_at >= ${yesterday})`,
      totalReceived: sql<number>`count(*) filter (where direction = 'inbound' and created_at >= ${yesterday})`,
    })
    .from(outreachLog)
  const [stats] = tenant
    ? await outreachBase.where(eq(outreachLog.tenantId, tenant.id))
    : await outreachBase

  const seqBase = db
    .select({
      active: sql<number>`count(*) filter (where status = 'active')`,
      completed: sql<number>`count(*) filter (where status = 'completed' and updated_at >= ${yesterday})`,
      cold: sql<number>`count(*) filter (where status = 'cold' and updated_at >= ${yesterday})`,
      positive: sql<number>`count(*) filter (where intent = 'positive' or intent = 'meeting' or intent = 'qualification')`,
    })
    .from(leadSequenceState)
  const [seqStats] = tenant ? await seqBase.where(eq(leadSequenceState.tenantId, tenant.id)) : await seqBase

  const hotWhere = tenant
    ? and(
        eq(leadSequenceState.tenantId, tenant.id),
        sql`${leadSequenceState.lastReplyAt} >= ${yesterday}`,
        sql`${leadSequenceState.intent} IN ('positive', 'meeting', 'pricing', 'qualification')`,
      )
    : and(
        sql`${leadSequenceState.lastReplyAt} >= ${yesterday}`,
        sql`${leadSequenceState.intent} IN ('positive', 'meeting', 'pricing', 'qualification')`,
      )

  const hotLeads = await db
    .select({
      leadName: leads.name,
      leadCity: leads.city,
      intent: leadSequenceState.intent,
      qualificationData: leadSequenceState.qualificationData,
    })
    .from(leadSequenceState)
    .innerJoin(leads, eq(leadSequenceState.leadId, leads.id))
    .where(hotWhere)
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
  const tenantHeader = tenant ? `🏢 ${tenant.name} (${tenant.slug})` : undefined

  const body = buildDailyDigestBody(
    brand,
    { totalSent: stats.totalSent, totalReceived: stats.totalReceived },
    seqStats,
    hotList,
    briefsBlock,
    tenantHeader,
  )

  await whatsappOutreachQueue.add(
    'send',
    {
      phoneDigits: phone,
      body,
      tenantId: tenant?.id ?? (process.env.DEFAULT_TENANT_ID?.trim() || undefined),
    },
    { removeOnComplete: true },
  )

  console.log(
    `[report-engine] Daily digest sent${tenant ? ` (${tenant.slug})` : ' (legacy / no tenants)'}`,
  )
}

cron.schedule('0 4 * * 1', async () => {
  await withCronLock('report-weekly', 900, async () => {
    try {
      await runWeeklySummaries()
    } catch (err) {
      console.error('[report-engine] Weekly summary error:', err)
    }
  })
})

async function runWeeklySummaries() {
  const phone = FOUNDER_PHONE()
  if (!phone) return

  const tenantRows = await listActiveTenants()
  if (tenantRows.length === 0) {
    await sendWeeklySummary(null)
    return
  }
  for (const t of tenantRows) {
    await sendWeeklySummary(t)
  }
}

async function sendWeeklySummary(tenant: TenantRow | null) {
  const phone = FOUNDER_PHONE()
  if (!phone) return

  const brand = getReportBrand()
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)

  const logBase = db
    .select({
      sent: sql<number>`count(*) filter (where direction = 'outbound' and created_at >= ${weekAgo})`,
      received: sql<number>`count(*) filter (where direction = 'inbound' and created_at >= ${weekAgo})`,
    })
    .from(outreachLog)
  const [stats] = tenant ? await logBase.where(eq(outreachLog.tenantId, tenant.id)) : await logBase

  const wkSeqBase = db
    .select({
      started: sql<number>`count(*) filter (where started_at >= ${weekAgo})`,
      completed: sql<number>`count(*) filter (where status = 'completed' and updated_at >= ${weekAgo})`,
      cold: sql<number>`count(*) filter (where status = 'cold' and updated_at >= ${weekAgo})`,
    })
    .from(leadSequenceState)
  const [seqStats] = tenant
    ? await wkSeqBase.where(eq(leadSequenceState.tenantId, tenant.id))
    : await wkSeqBase

  let leadStats: { total: number; thisWeek: number }
  if (tenant) {
    const [tl] = await db
      .select({
        total: sql<number>`count(*)::int`,
        thisWeek: sql<number>`count(*) filter (where ${tenantLeads.claimedAt} >= ${weekAgo})::int`,
      })
      .from(tenantLeads)
      .where(eq(tenantLeads.tenantId, tenant.id))
    leadStats = { total: tl?.total ?? 0, thisWeek: tl?.thisWeek ?? 0 }
  } else {
    const [ls] = await db
      .select({
        total: sql<number>`count(*)::int`,
        thisWeek: sql<number>`count(*) filter (where created_at >= ${weekAgo})::int`,
      })
      .from(leads)
    leadStats = { total: ls?.total ?? 0, thisWeek: ls?.thisWeek ?? 0 }
  }

  const replyRate = stats.sent > 0 ? Math.round((stats.received / stats.sent) * 100) : 0
  const conversionPct =
    seqStats.started > 0 ? Math.round((seqStats.completed / seqStats.started) * 100) : 0

  const tenantHeader = tenant ? `🏢 ${tenant.name} (${tenant.slug})` : undefined

  const body = buildWeeklySummaryBody(
    brand,
    leadStats,
    stats,
    seqStats,
    replyRate,
    conversionPct,
    tenantHeader,
  )

  await whatsappOutreachQueue.add(
    'send',
    {
      phoneDigits: phone,
      body,
      tenantId: tenant?.id ?? (process.env.DEFAULT_TENANT_ID?.trim() || undefined),
    },
    { removeOnComplete: true },
  )

  console.log(
    `[report-engine] Weekly summary sent${tenant ? ` (${tenant.slug})` : ' (legacy / no tenants)'}`,
  )
}

console.log('[report-engine] Report engine loaded (daily 9am + weekly Mon 10am Almaty)')

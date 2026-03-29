import { Hono } from 'hono'
import { db, companies, contacts as contactsTable, inArray } from '@leadiya/db'
import { sql, desc, eq, and, ilike, or, gte, lte, asc, exists, isNotNull, type SQL } from 'drizzle-orm'
import { Queue } from 'bullmq'
import { env } from '@leadiya/config'

const twogisEnrichJobOpts = { removeOnComplete: 200, removeOnFail: 500 } as const
import { leadDetailFields, leadExportFields, leadListFields } from '../lib/lead-select.js'
import type { AppEnv } from '../server.js'

const companiesRouter = new Hono<AppEnv>()

/** Caps to limit Supabase (hosted Postgres) egress per request. */
const LEADS_PAGE_MAX = 100
const LEADS_OFFSET_MAX = 25_000
const EXPORT_ROW_MAX = 3_000

const enrichmentQueue = new Queue('enrichment', { connection: { url: env.REDIS_URL } })
const twogisEnrichQueue = new Queue('enrich-twogis', { connection: { url: env.REDIS_URL } })

/** Latin UI labels + DB spellings (2GIS stores Cyrillic city names). */
const CITY_FILTER_ALIASES: Record<string, string[]> = {
  Almaty: ['Алматы', 'Almaty'],
  Astana: ['Астана', 'Astana', 'Нур-Султан'],
  Shymkent: ['Шымкент', 'Shymkent'],
  Aktobe: ['Актобе', 'Aktobe'],
  Karaganda: ['Караганда', 'Karaganda'],
  Taraz: ['Тараз', 'Taraz'],
  'Ust-Kamenogorsk': ['Усть-Каменогорск', 'Ust-Kamenogorsk'],
  Kostanay: ['Костанай', 'Kostanay'],
  Pavlodar: ['Павлодар', 'Pavlodar'],
}

function sanitizeIlikeFragment(s: string): string {
  return s.replace(/[%_\\]/g, '')
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function buildWhereClause(c: { req: { query: (k: string) => string | undefined } }): SQL | undefined {
  const qRaw = c.req.query('q')?.trim()
  const city = c.req.query('city')?.trim()
  const category = c.req.query('category')?.trim()
  const source = c.req.query('source')?.trim()
  const status = c.req.query('status')?.trim()
  const twogisCardCategory = c.req.query('twogisCardCategory')?.trim()
  const scraperRunId = c.req.query('scraperRunId')?.trim()
  const icpMin = c.req.query('icpMin') ? parseInt(c.req.query('icpMin')!, 10) : undefined
  const icpMax = c.req.query('icpMax') ? parseInt(c.req.query('icpMax')!, 10) : undefined

  const conditions: SQL[] = []

  if (scraperRunId && scraperRunId.length > 0 && UUID_RE.test(scraperRunId)) {
    conditions.push(sql`${companies.rawData}->>'twogisScraperRunId' = ${scraperRunId}`)
  }

  if (qRaw && qRaw.length > 0) {
    const safe = sanitizeIlikeFragment(qRaw)
    if (safe.length > 0) {
      const pat = `%${safe}%`
      conditions.push(
        or(
          ilike(companies.name, pat),
          ilike(companies.bin, pat),
          ilike(companies.city, pat),
          ilike(companies.category, pat),
          exists(
            db
              .select({ one: sql`1` })
              .from(contactsTable)
              .where(
                and(
                  eq(contactsTable.leadId, companies.id),
                  or(ilike(contactsTable.phone, pat), ilike(contactsTable.email, pat))
                )
              )
          )
        )!
      )
    }
  }

  if (city && city.length > 0 && city.toLowerCase() !== 'all') {
    const variants = CITY_FILTER_ALIASES[city] ?? [city]
    conditions.push(or(...variants.map((v) => eq(companies.city, v)))!)
  }
  if (category && category.length > 0 && category.toLowerCase() !== 'all') {
    if (category === '__empty__') {
      conditions.push(or(sql`trim(coalesce(${companies.category}, '')) = ''`, sql`${companies.category} is null`)!)
    } else {
      conditions.push(eq(companies.category, category))
    }
  }
  if (source && source.length > 0 && source.toLowerCase() !== 'all') {
    conditions.push(eq(companies.source, source))
  }
  if (status && status.length > 0 && status.toLowerCase() !== 'all') {
    conditions.push(eq(companies.status, status))
  }
  if (twogisCardCategory && twogisCardCategory.length > 0 && twogisCardCategory.toLowerCase() !== 'all') {
    const safe = sanitizeIlikeFragment(twogisCardCategory)
    if (safe.length > 0) conditions.push(ilike(companies.twogisCardCategory, `%${safe}%`))
  }
  if (icpMin !== undefined && !Number.isNaN(icpMin)) conditions.push(gte(companies.icpScore, icpMin))
  if (icpMax !== undefined && !Number.isNaN(icpMax)) conditions.push(lte(companies.icpScore, icpMax))

  return conditions.length > 0 ? and(...conditions) : undefined
}

/** Full-table facet counts for filter dropdowns (same shape as `GET /filters-meta`). */
async function loadFiltersMetaBuckets(limitBuckets: number) {
  const [cityRows, categoryRows, sourceRows, statusRows] = await Promise.all([
    db
      .select({
        value: companies.city,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(companies)
      .where(and(isNotNull(companies.city), sql`trim(${companies.city}) <> ''`))
      .groupBy(companies.city)
      .orderBy(desc(sql`count(*)`))
      .limit(limitBuckets),
    db
      .select({
        value: companies.category,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(companies)
      .where(and(isNotNull(companies.category), sql`trim(${companies.category}) <> ''`))
      .groupBy(companies.category)
      .orderBy(desc(sql`count(*)`))
      .limit(limitBuckets),
    db
      .select({
        value: companies.source,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(companies)
      .where(and(isNotNull(companies.source), sql`trim(${companies.source}) <> ''`))
      .groupBy(companies.source)
      .orderBy(desc(sql`count(*)`))
      .limit(limitBuckets),
    db
      .select({
        value: companies.status,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(companies)
      .where(and(isNotNull(companies.status), sql`trim(${companies.status}) <> ''`))
      .groupBy(companies.status)
      .orderBy(desc(sql`count(*)`))
      .limit(limitBuckets),
  ])

  const uncategorized = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(companies)
    .where(or(sql`trim(coalesce(${companies.category}, '')) = ''`, sql`${companies.category} is null`)!)

  const emptyCat = Number(uncategorized[0]?.count ?? 0)

  return {
    cities: cityRows.map((r) => ({ value: r.value as string, count: Number(r.count) })),
    categories: categoryRows.map((r) => ({ value: r.value as string, count: Number(r.count) })),
    uncategorizedCount: emptyCat,
    sources: sourceRows.map((r) => ({ value: r.value as string, count: Number(r.count) })),
    statuses: statusRows.map((r) => ({ value: r.value as string, count: Number(r.count) })),
  }
}

/** Distinct filter values + counts from the live table (keeps UI dropdowns aligned with data). */
companiesRouter.get('/filters-meta', async (c) => {
  const limitBuckets = Math.min(Math.max(parseInt(c.req.query('limitBuckets') || '120', 10), 1), 200)
  return c.json(await loadFiltersMetaBuckets(limitBuckets))
})

companiesRouter.get('/', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10), 1), LEADS_PAGE_MAX)
  const offset = Math.min(Math.max(parseInt(c.req.query('offset') || '0', 10), 0), LEADS_OFFSET_MAX)
  const sortBy = c.req.query('sortBy') || 'createdAt'
  const sortOrder = c.req.query('sortOrder') === 'asc' ? 'asc' : 'desc'
  const includeFiltersMeta =
    c.req.query('includeFiltersMeta') === '1' || c.req.query('includeFiltersMeta') === 'true'
  const limitBuckets = Math.min(Math.max(parseInt(c.req.query('limitBuckets') || '120', 10), 1), 200)

  const whereClause = buildWhereClause(c)

  type SortCol =
    | typeof companies.name
    | typeof companies.city
    | typeof companies.bin
    | typeof companies.status
    | typeof companies.createdAt
    | typeof companies.icpScore

  const sortCols: Record<string, SortCol> = {
    name: companies.name,
    city: companies.city,
    bin: companies.bin,
    status: companies.status,
    createdAt: companies.createdAt,
    icpScore: companies.icpScore,
  }
  const sortCol = sortCols[sortBy] ?? companies.createdAt
  const orderBy = sortOrder === 'asc' ? asc(sortCol) : desc(sortCol)

  const [totalCountResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(companies)
    .where(whereClause)

  const listPromise = db
    .select(leadListFields)
    .from(companies)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)

  const [results, filtersMeta] = await Promise.all([
    listPromise,
    includeFiltersMeta ? loadFiltersMetaBuckets(limitBuckets) : Promise.resolve(null),
  ])

  const total = Number(totalCountResult?.count || 0)
  const companyIds = results.map((r) => r.id)

  if (companyIds.length === 0) {
    return c.json({
      items: [],
      pagination: { total, limit, offset },
      ...(filtersMeta ? { filtersMeta } : {}),
    })
  }

  const contactsForResults = await db
    .select()
    .from(contactsTable)
    .where(inArray(contactsTable.leadId, companyIds))

  const items = results.map((company) => ({
    ...company,
    contacts: contactsForResults.filter((ct) => ct.leadId === company.id),
  }))

  return c.json({
    items,
    pagination: { total, limit, offset },
    ...(filtersMeta ? { filtersMeta } : {}),
  })
})

companiesRouter.get('/export', async (c) => {
  const whereClause = buildWhereClause(c)
  const format = c.req.query('format') || 'csv'
  const exportLimit = Math.min(
    Math.max(parseInt(c.req.query('limit') || String(EXPORT_ROW_MAX), 10), 1),
    EXPORT_ROW_MAX
  )

  const results = await db
    .select(leadExportFields)
    .from(companies)
    .where(whereClause)
    .limit(exportLimit)

  if (format === 'json') {
    return c.json(results)
  }

  const headers = [
    'Name', 'BIN', 'City', 'Category', 'Website', 'Email', 'WhatsApp',
    'Instagram', 'Telegram', 'Status', 'Employee Band', 'Legal Status',
    'OKED', 'ICP Score', 'Rating 2GIS', 'Created',
  ]

  const rows = results.map((l) =>
    [
      l.name, l.bin, l.city, l.category, l.website, l.email, l.whatsapp,
      l.instagram, l.telegram, l.status, l.employeeBand, l.legalStatus,
      l.okedName || l.okedCode, l.icpScore, l.rating2gis,
      l.createdAt?.toISOString().slice(0, 10),
    ]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',')
  )

  // UTF-8 BOM for Excel compatibility
  const bom = '\uFEFF'
  const csv = bom + [headers.join(','), ...rows].join('\r\n')

  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="leads_${new Date().toISOString().slice(0, 10)}.csv"`)
  return c.body(csv)
})

companiesRouter.get('/bin/:bin', async (c) => {
  const bin = c.req.param('bin')
  const [company] = await db
    .select(leadDetailFields)
    .from(companies)
    .where(eq(companies.bin, bin))
    .limit(1)
  if (!company) return c.json({ error: 'Company not found', code: 'NOT_FOUND' }, 404)
  return c.json(company)
})

companiesRouter.get('/:id', async (c) => {
  const id = c.req.param('id')

  const [company] = await db
    .select(leadDetailFields)
    .from(companies)
    .where(eq(companies.id, id))
    .limit(1)
  if (!company) return c.json({ error: 'Company not found', code: 'NOT_FOUND' }, 404)

  const companyContacts = await db.select().from(contactsTable).where(eq(contactsTable.leadId, id))

  return c.json({ ...company, contacts: companyContacts })
})

companiesRouter.post('/:id/enrich', async (c) => {
  const id = c.req.param('id')

  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, id))
    .limit(1)
  if (!company) return c.json({ error: 'Lead not found', code: 'NOT_FOUND' }, 404)

  let forceTwogis = false
  const ct = c.req.header('content-type') || ''
  if (ct.includes('application/json')) {
    try {
      const body = (await c.req.json()) as { forceTwogis?: boolean }
      forceTwogis = Boolean(body?.forceTwogis)
    } catch {
      /* empty or invalid body */
    }
  }

  await enrichmentQueue.add('enrich', { leadIds: [id] }, { jobId: `enrich-single-${id}` })

  if (forceTwogis) {
    await twogisEnrichQueue.add(
      'enrich',
      { leadId: id, force: true },
      {
        ...twogisEnrichJobOpts,
        jobId: `twogis-force-${id}-${Date.now()}`,
      }
    )
  }

  return c.json(
    {
      message: 'Enrichment queued',
      leadId: id,
      ...(forceTwogis ? { twogisSearchReRun: true as const } : {}),
    },
    202
  )
})

companiesRouter.post('/bulk-action', async (c) => {
  const { ids, action, forceTwogis } = (await c.req.json()) as {
    ids: string[]
    action: string
    forceTwogis?: boolean
  }

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: 'No IDs provided', code: 'VALIDATION_ERROR' }, 400)
  }

  switch (action) {
    case 'archive':
      await db
        .update(companies)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(inArray(companies.id, ids))
      return c.json({ message: `Archived ${ids.length} leads`, count: ids.length })

    /** Move leads back to the default working status (e.g. after mistaken archive). */
    case 'restore':
      await db
        .update(companies)
        .set({ status: 'valid', updatedAt: new Date() })
        .where(inArray(companies.id, ids))
      return c.json({ message: `Restored ${ids.length} leads`, count: ids.length })

    case 'delete':
      try {
        await db.delete(companies).where(inArray(companies.id, ids))
      } catch (e: unknown) {
        const code =
          e && typeof e === 'object' && 'code' in e
            ? String((e as { code: unknown }).code)
            : e && typeof e === 'object' && 'cause' in e && (e as { cause: unknown }).cause != null
              ? String((e as { cause: { code?: string } }).cause?.code ?? '')
              : ''
        if (code === '23503') {
          return c.json(
            {
              error:
                'Cannot delete: another table still references one of these leads (for example tenders). Remove those links first.',
              code: 'DELETE_REFERENCED',
            },
            409,
          )
        }
        console.error('[companies/bulk-action] delete failed:', e)
        return c.json({ error: 'Delete failed', code: 'DELETE_FAILED' }, 500)
      }
      return c.json({ message: `Deleted ${ids.length} leads`, count: ids.length })

    case 'enrich':
      await enrichmentQueue.add('enrich', { leadIds: ids }, { jobId: `enrich-bulk-${Date.now()}` })
      if (forceTwogis) {
        const ts = Date.now()
        for (let i = 0; i < ids.length; i++) {
          const leadId = ids[i]!
          await twogisEnrichQueue.add(
            'enrich',
            { leadId, force: true },
            { ...twogisEnrichJobOpts, jobId: `twogis-force-${leadId}-${ts}-${i}` }
          )
        }
      }
      return c.json(
        {
          message: `Enrichment queued for ${ids.length} leads`,
          count: ids.length,
          ...(forceTwogis ? { twogisSearchReRunQueued: ids.length } : {}),
        },
        202
      )

    default:
      return c.json({ error: 'Invalid action', code: 'VALIDATION_ERROR' }, 400)
  }
})

export { companiesRouter }

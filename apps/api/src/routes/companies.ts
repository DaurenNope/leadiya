import { Hono } from 'hono'
import { db, companies, contacts as contactsTable, inArray } from '@leadiya/db'
import { sql, desc, eq, and, ilike, or, gte, lte, asc } from 'drizzle-orm'
import { Queue } from 'bullmq'
import { env } from '@leadiya/config'
import { leadDetailFields, leadExportFields, leadListFields } from '../lib/lead-select.js'
import type { AppEnv } from '../server.js'

const companiesRouter = new Hono<AppEnv>()

/** Caps to limit Supabase (hosted Postgres) egress per request. */
const LEADS_PAGE_MAX = 100
const LEADS_OFFSET_MAX = 25_000
const EXPORT_ROW_MAX = 3_000

const enrichmentQueue = new Queue('enrichment', { connection: { url: env.REDIS_URL } })

function buildWhereClause(c: { req: { query: (k: string) => string | undefined } }) {
  const q = c.req.query('q')
  const city = c.req.query('city')
  const category = c.req.query('category')
  const source = c.req.query('source')
  const status = c.req.query('status')
  const icpMin = c.req.query('icpMin') ? parseInt(c.req.query('icpMin')!) : undefined
  const icpMax = c.req.query('icpMax') ? parseInt(c.req.query('icpMax')!) : undefined

  const conditions = []

  if (q) {
    conditions.push(
      or(
        ilike(companies.name, `%${q}%`),
        ilike(companies.bin, `%${q}%`),
        ilike(companies.city, `%${q}%`),
        ilike(companies.category, `%${q}%`)
      )
    )
  }
  if (city && city !== 'ALL CITIES') conditions.push(eq(companies.city, city))
  if (category && category !== 'ALL SECTORS') conditions.push(eq(companies.category, category))
  if (source && source !== 'ALL SOURCES') conditions.push(eq(companies.source, source))
  if (status && status !== 'ALL STATES') conditions.push(eq(companies.status, status))
  if (icpMin !== undefined) conditions.push(gte(companies.icpScore, icpMin))
  if (icpMax !== undefined) conditions.push(lte(companies.icpScore, icpMax))

  return conditions.length > 0 ? and(...conditions) : undefined
}

companiesRouter.get('/', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10), 1), LEADS_PAGE_MAX)
  const offset = Math.min(Math.max(parseInt(c.req.query('offset') || '0', 10), 0), LEADS_OFFSET_MAX)
  const sortBy = c.req.query('sortBy') || 'createdAt'
  const sortOrder = c.req.query('sortOrder') || 'desc'

  const whereClause = buildWhereClause(c)

  const [totalCountResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(companies)
    .where(whereClause)

  const total = Number(totalCountResult?.count || 0)

  const sortCol = (companies as any)[sortBy] || companies.createdAt
  const orderBy = sortOrder === 'asc' ? asc(sortCol) : desc(sortCol)

  const results = await db
    .select(leadListFields)
    .from(companies)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset)

  const companyIds = results.map((r) => r.id)

  if (companyIds.length === 0) {
    return c.json({ items: [], pagination: { total, limit, offset } })
  }

  const contactsForResults = await db
    .select()
    .from(contactsTable)
    .where(inArray(contactsTable.leadId, companyIds))

  const items = results.map((company) => ({
    ...company,
    contacts: contactsForResults.filter((ct) => ct.leadId === company.id),
  }))

  return c.json({ items, pagination: { total, limit, offset } })
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

companiesRouter.post('/:id/enrich', async (c) => {
  const id = c.req.param('id')

  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, id))
    .limit(1)
  if (!company) return c.json({ error: 'Company not found', code: 'NOT_FOUND' }, 404)

  await enrichmentQueue.add('enrich', { leadIds: [id] }, { jobId: `enrich-single:${id}` })
  return c.json({ message: 'Enrichment queued', leadId: id }, 202)
})

companiesRouter.post('/bulk-action', async (c) => {
  const { ids, action } = (await c.req.json()) as { ids: string[]; action: string }

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

    case 'delete':
      await db.delete(companies).where(inArray(companies.id, ids))
      return c.json({ message: `Deleted ${ids.length} leads`, count: ids.length })

    case 'enrich':
      await enrichmentQueue.add('enrich', { leadIds: ids }, { jobId: `enrich-bulk:${Date.now()}` })
      return c.json({ message: `Enrichment queued for ${ids.length} leads`, count: ids.length }, 202)

    default:
      return c.json({ error: 'Invalid action', code: 'VALIDATION_ERROR' }, 400)
  }
})

export { companiesRouter }

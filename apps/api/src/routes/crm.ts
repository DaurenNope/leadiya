import { Hono } from 'hono'
import { db, tenantLeads, leads, contacts as contactsTable, eq, and, sql, inArray, desc, asc } from '@leadiya/db'
import type { AppEnv } from '../types.js'

const crmRouter = new Hono<AppEnv>()

const PAGE_MAX = 100

function requireTenant(c: any): string | null {
  const tenant = c.get('tenant')
  if (!tenant?.id) {
    c.json({ error: 'Tenant required', code: 'TENANT_REQUIRED' }, 403)
    return null
  }
  return tenant.id
}

/**
 * POST /api/crm/leads/claim — claim companies into tenant's CRM.
 * Body: { leadIds: string[] }
 */
crmRouter.post('/leads/claim', async (c) => {
  const tenantId = requireTenant(c)
  if (!tenantId) return c.res

  const body = await c.req.json() as { leadIds?: string[] }
  if (!body.leadIds?.length) {
    return c.json({ error: 'No leadIds provided', code: 'VALIDATION_ERROR' }, 400)
  }

  const ids = body.leadIds.slice(0, 500)

  const existing = await db
    .select({ leadId: tenantLeads.leadId })
    .from(tenantLeads)
    .where(and(eq(tenantLeads.tenantId, tenantId), inArray(tenantLeads.leadId, ids)))

  const existingSet = new Set(existing.map((r) => r.leadId))
  const newIds = ids.filter((id) => !existingSet.has(id))

  if (newIds.length === 0) {
    return c.json({ claimed: 0, alreadyClaimed: ids.length })
  }

  const values = newIds.map((leadId) => ({
    tenantId,
    leadId,
  }))

  await db.insert(tenantLeads).values(values).onConflictDoNothing()

  return c.json({ claimed: newIds.length, alreadyClaimed: ids.length - newIds.length }, 201)
})

/**
 * GET /api/crm/leads — list tenant's claimed leads with company data joined.
 */
crmRouter.get('/leads', async (c) => {
  const tenantId = requireTenant(c)
  if (!tenantId) return c.res

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10), 1), PAGE_MAX)
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0)
  const status = c.req.query('status')?.trim()
  const q = c.req.query('q')?.trim()
  const sortBy = c.req.query('sortBy') || 'claimedAt'
  const sortOrder = c.req.query('sortOrder') === 'asc' ? 'asc' : 'desc'

  const conditions = [eq(tenantLeads.tenantId, tenantId)]

  if (status && status !== 'all') {
    conditions.push(eq(tenantLeads.crmStatus, status))
  }

  if (q && q.length > 0) {
    const pat = `%${q.replace(/[%_\\]/g, '')}%`
    conditions.push(
      sql`(${leads.name} ILIKE ${pat} OR ${leads.city} ILIKE ${pat} OR ${leads.category} ILIKE ${pat})`
    )
  }

  const where = and(...conditions)

  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(tenantLeads)
    .innerJoin(leads, eq(tenantLeads.leadId, leads.id))
    .where(where)

  const total = Number(countRow?.count ?? 0)

  const sortCols: Record<string, any> = {
    claimedAt: tenantLeads.claimedAt,
    name: leads.name,
    city: leads.city,
    crmStatus: tenantLeads.crmStatus,
    updatedAt: tenantLeads.updatedAt,
  }
  const sortCol = sortCols[sortBy] ?? tenantLeads.claimedAt
  const orderFn = sortOrder === 'asc' ? asc : desc

  const rows = await db
    .select({
      id: tenantLeads.id,
      leadId: tenantLeads.leadId,
      crmStatus: tenantLeads.crmStatus,
      notes: tenantLeads.notes,
      tags: tenantLeads.tags,
      claimedAt: tenantLeads.claimedAt,
      tlUpdatedAt: tenantLeads.updatedAt,
      companyName: leads.name,
      companyCity: leads.city,
      companyCategory: leads.category,
      companyAddress: leads.address,
      companyWebsite: leads.website,
      companyEmail: leads.email,
      companyWhatsapp: leads.whatsapp,
      companyInstagram: leads.instagram,
      companyTelegram: leads.telegram,
      companyPhone: sql<string>`(SELECT phone FROM contacts WHERE lead_id = ${leads.id} AND phone IS NOT NULL LIMIT 1)`,
      companyRating: leads.rating2gis,
      companyIcpScore: leads.icpScore,
    })
    .from(tenantLeads)
    .innerJoin(leads, eq(tenantLeads.leadId, leads.id))
    .where(where)
    .orderBy(orderFn(sortCol))
    .limit(limit)
    .offset(offset)

  return c.json({
    items: rows,
    pagination: { total, limit, offset },
  })
})

/**
 * PATCH /api/crm/leads/:id — update CRM status, notes, tags.
 */
crmRouter.patch('/leads/:id', async (c) => {
  const tenantId = requireTenant(c)
  if (!tenantId) return c.res

  const id = c.req.param('id')
  const body = await c.req.json() as {
    crmStatus?: string
    notes?: string
    tags?: string[]
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body.crmStatus) updates.crmStatus = body.crmStatus
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.tags !== undefined) updates.tags = body.tags

  const [updated] = await db
    .update(tenantLeads)
    .set(updates)
    .where(and(eq(tenantLeads.id, id), eq(tenantLeads.tenantId, tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Lead not found in your CRM', code: 'NOT_FOUND' }, 404)
  }

  return c.json({ lead: updated })
})

/**
 * DELETE /api/crm/leads/:id — unclaim lead from CRM.
 */
crmRouter.delete('/leads/:id', async (c) => {
  const tenantId = requireTenant(c)
  if (!tenantId) return c.res

  const id = c.req.param('id')

  const [deleted] = await db
    .delete(tenantLeads)
    .where(and(eq(tenantLeads.id, id), eq(tenantLeads.tenantId, tenantId)))
    .returning({ id: tenantLeads.id })

  if (!deleted) {
    return c.json({ error: 'Lead not found in your CRM', code: 'NOT_FOUND' }, 404)
  }

  return c.json({ removed: true })
})

/**
 * POST /api/crm/leads/bulk-action — bulk operations on CRM leads.
 * Body: { ids: string[], action: 'update_status' | 'remove', crmStatus?: string }
 */
crmRouter.post('/leads/bulk-action', async (c) => {
  const tenantId = requireTenant(c)
  if (!tenantId) return c.res

  const { ids, action, crmStatus } = await c.req.json() as {
    ids: string[]
    action: string
    crmStatus?: string
  }

  if (!ids?.length) {
    return c.json({ error: 'No IDs provided', code: 'VALIDATION_ERROR' }, 400)
  }

  const where = and(eq(tenantLeads.tenantId, tenantId), inArray(tenantLeads.id, ids))

  switch (action) {
    case 'update_status':
      if (!crmStatus) return c.json({ error: 'crmStatus required', code: 'VALIDATION_ERROR' }, 400)
      await db.update(tenantLeads).set({ crmStatus, updatedAt: new Date() }).where(where)
      return c.json({ updated: ids.length })

    case 'remove':
      await db.delete(tenantLeads).where(where)
      return c.json({ removed: ids.length })

    default:
      return c.json({ error: 'Invalid action', code: 'VALIDATION_ERROR' }, 400)
  }
})

/**
 * GET /api/crm/stats — aggregate CRM stats for tenant.
 */
crmRouter.get('/stats', async (c) => {
  const tenantId = requireTenant(c)
  if (!tenantId) return c.res

  const rows = await db
    .select({
      status: tenantLeads.crmStatus,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(tenantLeads)
    .where(eq(tenantLeads.tenantId, tenantId))
    .groupBy(tenantLeads.crmStatus)

  const stats: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    stats[r.status] = r.count
    total += r.count
  }

  return c.json({ stats, total })
})

export { crmRouter }

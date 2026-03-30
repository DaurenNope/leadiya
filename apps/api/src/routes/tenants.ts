import { Hono } from 'hono'
import { db, tenants, eq } from '@leadiya/db'
import type { AppEnv } from '../types.js'

const tenantsRouter = new Hono<AppEnv>()

function slugFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'user'
  return local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'user'
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base
  let attempt = 0
  for (;;) {
    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1)
    if (!existing) return slug
    attempt++
    slug = `${base}-${attempt}`
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * GET /api/tenants/me — returns the authenticated user's tenant.
 * POST /api/tenants/me — creates a tenant for the user if none exists.
 */
tenantsRouter.get('/me', async (c) => {
  // If tenant middleware already resolved a tenant, return it
  const resolved = c.get('tenant')
  if (resolved?.id) return c.json({ tenant: resolved })

  const user = c.get('user') as { id: string; email?: string | null }
  if (!UUID_RE.test(user.id)) {
    return c.json({ error: 'No tenant found', code: 'TENANT_NOT_FOUND' }, 404)
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.ownerId, user.id))
    .limit(1)

  if (!tenant) {
    return c.json({ error: 'No tenant found', code: 'TENANT_NOT_FOUND' }, 404)
  }

  return c.json({ tenant })
})

tenantsRouter.post('/me', async (c) => {
  // If tenant middleware already resolved, return it
  const resolved = c.get('tenant')
  if (resolved?.id) return c.json({ tenant: resolved })

  const user = c.get('user') as { id: string; email?: string | null }
  if (!UUID_RE.test(user.id)) {
    return c.json({ error: 'Cannot create tenant for bypass user', code: 'AUTH_REQUIRED' }, 400)
  }

  const [existing] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.ownerId, user.id))
    .limit(1)

  if (existing) {
    return c.json({ tenant: existing })
  }

  let name = 'Моя компания'
  let body: { name?: string } | null = null
  try {
    body = await c.req.json()
  } catch { /* empty body is fine */ }
  if (body?.name?.trim()) {
    name = body.name.trim()
  }

  const baseSlug = slugFromEmail(user.email ?? 'user')
  const slug = await uniqueSlug(baseSlug)

  const trialEndsAt = new Date()
  trialEndsAt.setDate(trialEndsAt.getDate() + 14)

  const [tenant] = await db
    .insert(tenants)
    .values({
      name,
      slug,
      ownerId: user.id,
      trialEndsAt,
    })
    .returning()

  return c.json({ tenant }, 201)
})

export { tenantsRouter }

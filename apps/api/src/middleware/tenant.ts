import { db, tenants, eq } from '@leadiya/db'
import type { MiddlewareHandler } from 'hono'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Resolves the tenant from the authenticated user.
 * Sets c.get('tenant') = { id, slug, name, ... } or null.
 * Does NOT block requests when no tenant is found — routes that require a tenant
 * should check `c.get('tenant')` themselves.
 */
export const tenantMiddleware: MiddlewareHandler = async (c, next) => {
  const user = c.get('user') as { id: string; email?: string | null } | undefined
  if (!user || user.id === 'agent-service') {
    c.set('tenant', null)
    return next()
  }

  // AUTH_BYPASS user.id is 'dev' — not a UUID, look up by DEFAULT_TENANT_ID
  if (!UUID_RE.test(user.id)) {
    const fallbackId = process.env.DEFAULT_TENANT_ID
    if (fallbackId && UUID_RE.test(fallbackId)) {
      try {
        const [tenant] = await db
          .select()
          .from(tenants)
          .where(eq(tenants.id, fallbackId))
          .limit(1)
        c.set('tenant', tenant ?? null)
      } catch (err) {
        console.error('[tenant] DB error (fallback lookup):', err)
        c.set('tenant', null)
      }
    } else {
      c.set('tenant', null)
    }
    return next()
  }

  try {
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.ownerId, user.id))
      .limit(1)
    c.set('tenant', tenant ?? null)
  } catch (err) {
    console.error('[tenant] DB error (owner lookup):', err)
    c.set('tenant', null)
  }
  return next()
}

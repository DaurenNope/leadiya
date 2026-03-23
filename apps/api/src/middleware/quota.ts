import { db } from '@leadiya/db'
import { tenants } from '@leadiya/db'
import { eq } from 'drizzle-orm'

export async function quotaMiddleware(c: any, next: any) {
  const user = c.get('user')
  
  if (!user) {
    return c.json({ error: 'User not authenticated' }, 401)
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.ownerId, user.id))
    .limit(1)

  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404)
  }

  if (!tenant.active) {
    return c.json({ error: 'Tenant subscription not active' }, 403)
  }

  if (tenant.quotaResetAt && new Date() > tenant.quotaResetAt) {
    await db.update(tenants)
      .set({ exportsUsed: 0, quotaResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) })
      .where(eq(tenants.id, tenant.id))
    tenant.exportsUsed = 0
  }

  c.set('tenant', tenant)
  return next()
}

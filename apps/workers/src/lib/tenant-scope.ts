import { eq, or, isNull } from '@leadiya/db'

/**
 * For the default tenant only, allow legacy/null tenant rows in addition to strict tenant rows.
 * Non-default tenants are always strictly scoped.
 */
export function buildTenantOrLegacyNullClause(
  tenantColumn: unknown,
  tenantId: string,
  defaultTenantId?: string | null,
) {
  if (defaultTenantId && tenantId === defaultTenantId) {
    return or(eq(tenantColumn as never, tenantId as never), isNull(tenantColumn as never))
  }
  return eq(tenantColumn as never, tenantId as never)
}

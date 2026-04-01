import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctx = vi.hoisted(() => {
  const eq = vi.fn(() => ({ tag: 'eq' }))
  const or = vi.fn(() => ({ tag: 'or' }))
  const isNull = vi.fn(() => ({ tag: 'isNull' }))
  return { eq, or, isNull }
})

vi.mock('@leadiya/db', () => ({
  eq: ctx.eq,
  or: ctx.or,
  isNull: ctx.isNull,
}))

import { buildTenantOrLegacyNullClause } from './tenant-scope.js'

describe('buildTenantOrLegacyNullClause', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses strict tenant filter for non-default tenant', () => {
    const column = 'outreachLog.tenantId'
    buildTenantOrLegacyNullClause(column, 'tenant-b', 'tenant-a')
    expect(ctx.eq).toHaveBeenCalledWith(column, 'tenant-b')
    expect(ctx.or).not.toHaveBeenCalled()
    expect(ctx.isNull).not.toHaveBeenCalled()
  })

  it('allows legacy null rows for default tenant', () => {
    const column = 'outreachLog.tenantId'
    buildTenantOrLegacyNullClause(column, 'tenant-a', 'tenant-a')
    expect(ctx.eq).toHaveBeenCalledWith(column, 'tenant-a')
    expect(ctx.isNull).toHaveBeenCalledWith(column)
    expect(ctx.or).toHaveBeenCalledTimes(1)
  })
})

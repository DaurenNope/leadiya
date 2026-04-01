import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctx = vi.hoisted(() => {
  const rowsQueue: unknown[] = []
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(rowsQueue.shift() ?? [])),
          })),
        })),
      })),
    })),
  }
  return { rowsQueue, db }
})

vi.mock('@leadiya/db', () => ({
  db: ctx.db,
  leadSequenceState: {
    status: 'leadSequenceState.status',
    leadId: 'leadSequenceState.leadId',
    sequenceKey: 'leadSequenceState.sequenceKey',
    updatedAt: 'leadSequenceState.updatedAt',
  },
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
}))

import { shouldSuppressSequenceSend } from './sequence-send-guard.js'

describe('shouldSuppressSequenceSend', () => {
  beforeEach(() => {
    ctx.rowsQueue.length = 0
    vi.clearAllMocks()
  })

  it('returns false when lead/sequence identifiers missing', async () => {
    await expect(shouldSuppressSequenceSend(undefined, 'cold_outreach')).resolves.toBe(false)
    await expect(shouldSuppressSequenceSend('lead-1', undefined)).resolves.toBe(false)
    expect(ctx.db.select).not.toHaveBeenCalled()
  })

  it('returns true when latest state is not active', async () => {
    ctx.rowsQueue.push([{ status: 'cold' }])
    await expect(shouldSuppressSequenceSend('lead-1', 'cold_outreach')).resolves.toBe(true)
  })

  it('returns false when latest state is active or absent', async () => {
    ctx.rowsQueue.push([{ status: 'active' }], [])
    await expect(shouldSuppressSequenceSend('lead-1', 'cold_outreach')).resolves.toBe(false)
    await expect(shouldSuppressSequenceSend('lead-1', 'cold_outreach')).resolves.toBe(false)
  })
})

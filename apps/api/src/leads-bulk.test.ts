import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctx = vi.hoisted(() => {
  vi.stubEnv('AUTH_BYPASS', 'true')
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/leadiya_test')
  vi.stubEnv('DATABASE_DIRECT_URL', 'postgresql://user:pass@localhost:5432/leadiya_test')
  vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379')
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_vitest_placeholder_key_only')
  vi.stubEnv('DEFAULT_TENANT_ID', '')
  vi.stubEnv('WHATSAPP_BAILEYS_ENABLED', 'false')

  const insertCalls: unknown[][] = []

  function makeSelectChain(result: unknown): PromiseLike<unknown> & Record<string, ReturnType<typeof vi.fn>> {
    const promise = Promise.resolve(result)
    const chain = {
      from: vi.fn(function (this: typeof chain) { return this }),
      where: vi.fn(function (this: typeof chain) { return this }),
      orderBy: vi.fn(function (this: typeof chain) { return this }),
      limit: vi.fn(function (this: typeof chain) { return this }),
      offset: vi.fn(function (this: typeof chain) { return this }),
      then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        promise.then(onFulfilled as never, onRejected),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    }
    return chain as PromiseLike<unknown> & typeof chain
  }

  const db = {
    select: vi.fn((_cols?: unknown) => makeSelectChain([])),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((vals: unknown) => {
        insertCalls.push([table, vals])
        return {
          returning: vi.fn(() =>
            Promise.resolve([{ id: '11111111-1111-1111-1111-111111111111' }]),
          ),
          onConflictDoNothing: vi.fn(() => Promise.resolve()),
          onConflictDoUpdate: vi.fn(() => Promise.resolve()),
        }
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([])),
    })),
  }

  return { insertCalls, db }
})

vi.mock('bullmq', () => ({
  Queue: vi.fn(function QueueMock(this: { add: ReturnType<typeof vi.fn> }) {
    this.add = vi.fn().mockResolvedValue(undefined)
    return this
  }),
}))

vi.mock('@leadiya/scrapers', () => ({
  run2GisScraper: vi.fn().mockResolvedValue({ total: 0, leadIds: [] }),
}))

vi.mock('@leadiya/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@leadiya/db')>()
  return {
    ...actual,
    db: ctx.db,
  }
})

vi.mock('@leadiya/queue', () => ({
  whatsappOutreachQueue: {
    add: vi.fn().mockResolvedValue(undefined),
  },
}))

import { app } from './server.js'

describe('Leads bulk', () => {
  beforeEach(() => {
    ctx.insertCalls.length = 0
    vi.clearAllMocks()
  })

  it('adds contacts for duplicate lead on recapture', async () => {
    const name = 'Tour Hunter Test'
    const city = 'Алматы'

    const first = await app.request('/api/leads/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leads: [
          {
            name,
            city,
            phones: ['+77070000001'],
            emails: [],
            sourceUrl: 'https://2gis.kz/almaty/firm/tour-hunter-test',
          },
        ],
      }),
    })
    expect(first.status).toBe(200)

    const second = await app.request('/api/leads/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leads: [
          {
            name,
            city,
            phones: ['+77070000001', '+77070000002'],
            emails: [],
            sourceUrl: 'https://2gis.kz/almaty/firm/tour-hunter-test',
          },
        ],
      }),
    })
    expect(second.status).toBe(200)

    expect(ctx.insertCalls.length).toBeGreaterThan(0)
  })
})

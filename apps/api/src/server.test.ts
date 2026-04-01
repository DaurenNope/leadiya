import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Shared mock state + env — runs before any module imports that read config. */
const ctx = vi.hoisted(() => {
  vi.stubEnv('AUTH_BYPASS', 'true')
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/leadiya_test')
  vi.stubEnv('DATABASE_DIRECT_URL', 'postgresql://user:pass@localhost:5432/leadiya_test')
  vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379')
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_vitest_placeholder_key_only')
  vi.stubEnv('DEFAULT_TENANT_ID', '')
  /** Deterministic outreach tests; dotenv will not override if already set. */
  vi.stubEnv('WHATSAPP_BAILEYS_ENABLED', 'false')

  const selectQueue: unknown[] = []

  const run2GisScraper = vi.fn().mockResolvedValue({ total: 0, leadIds: [] })

  function makeSelectChain(result: unknown): PromiseLike<unknown> & Record<string, ReturnType<typeof vi.fn>> {
    const promise = Promise.resolve(result)
    const chain = {
      from: vi.fn(function (this: typeof chain) {
        return this
      }),
      where: vi.fn(function (this: typeof chain) {
        return this
      }),
      orderBy: vi.fn(function (this: typeof chain) {
        return this
      }),
      limit: vi.fn(function (this: typeof chain) {
        return this
      }),
      offset: vi.fn(function (this: typeof chain) {
        return this
      }),
      then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        promise.then(onFulfilled as never, onRejected),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    }
    return chain as PromiseLike<unknown> & typeof chain
  }

  const db = {
    select: vi.fn((_cols?: unknown) => {
      const row = selectQueue.length > 0 ? selectQueue.shift()! : []
      return makeSelectChain(row)
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() =>
          Promise.resolve([{ id: '11111111-1111-1111-1111-111111111111' }]),
        ),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve([])),
    })),
    transaction: vi.fn(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: db.select,
        insert: db.insert,
      }
      return fn(tx)
    }),
  }

  const inArray = vi.fn(() => ({ __tag: 'inArray' as const }))

  const whatsappAdd = vi.fn().mockResolvedValue({ id: 'wa-job-1' })

  return { selectQueue, run2GisScraper, db, inArray, whatsappAdd }
})

vi.mock('bullmq', () => ({
  Queue: vi.fn(function QueueMock(this: { add: ReturnType<typeof vi.fn> }) {
    this.add = vi.fn().mockResolvedValue(undefined)
    return this
  }),
}))

vi.mock('@leadiya/scrapers', () => ({
  run2GisScraper: ctx.run2GisScraper,
}))

vi.mock('@leadiya/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@leadiya/db')>()
  return {
    ...actual,
    db: ctx.db,
    inArray: ctx.inArray,
  }
})

vi.mock('@leadiya/queue', () => ({
  whatsappOutreachQueue: {
    add: (...args: unknown[]) => ctx.whatsappAdd(...args),
  },
}))

import { Hono } from 'hono'
import { app } from './server.js'
import { authMiddleware } from './middleware/auth.js'

const authProbe = new Hono()
authProbe.use('*', authMiddleware)
authProbe.get('/probe', (c) => c.json({ user: c.get('user') }))

describe('API (Hono)', () => {
  beforeEach(() => {
    ctx.selectQueue.length = 0
    vi.clearAllMocks()
    ctx.run2GisScraper.mockResolvedValue({ total: 0, leadIds: [] })
  })

  describe('Health endpoint', () => {
    it('GET /health returns 200 with { status: ok }', async () => {
      const res = await app.request('/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        status: string
        service?: string
        env?: string
        agentBridgeConfigured?: boolean
      }
      expect(body.status).toBe('ok')
      expect(body.service).toBe('leadiya-api')
      expect(typeof body.agentBridgeConfigured).toBe('boolean')
    })
  })

  describe('System routes', () => {
    it('GET /api/system/capabilities returns integration flags', async () => {
      const res = await app.request('/api/system/capabilities')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        agentBridge: { configured: boolean; headerName: string }
        auth: { bypass: boolean }
        integrations: Record<string, boolean>
      }
      expect(body.agentBridge.headerName).toBe('X-Leadiya-Service-Key')
      expect(body.auth.bypass).toBe(true)
      expect(typeof body.agentBridge.configured).toBe('boolean')
    })
  })

  describe('Auth middleware', () => {
    it('with AUTH_BYPASS=true, /api/* requests are allowed through', async () => {
      ctx.selectQueue.push([{ count: 0 }], [])
      const res = await app.request('/api/companies')
      expect(res.status).toBe(200)
    })

    it('sets user to dev identity in bypass mode', async () => {
      const res = await authProbe.request('/probe')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { user: { id: string; email: string } }
      expect(body.user).toEqual({ id: 'dev', email: 'dev@localhost' })
    })
  })

  describe('Companies routes', () => {
    it('GET /api/companies returns paginated { items, pagination }', async () => {
      ctx.selectQueue.push([{ count: 0 }], [])
      const res = await app.request('/api/companies')
      expect(res.status).toBe(200)
      const data = (await res.json()) as {
        items: unknown[]
        pagination: { total: number; limit: number; offset: number }
      }
      expect(Array.isArray(data.items)).toBe(true)
      expect(data.pagination).toMatchObject({ total: 0, limit: 50, offset: 0 })
    })

    it('GET /api/companies/:id returns 404 for unknown ID', async () => {
      ctx.selectQueue.push([])
      const res = await app.request('/api/companies/00000000-0000-0000-0000-000000000099')
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: string }
      expect(body.code).toBe('NOT_FOUND')
    })

    it('POST /api/companies/bulk-action returns 400 when ids missing', async () => {
      const res = await app.request('/api/companies/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: string }
      expect(body.code).toBe('VALIDATION_ERROR')
    })

    it('POST /api/companies/bulk-action returns 400 for invalid action', async () => {
      const res = await app.request('/api/companies/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['a'], action: 'not-a-real-action' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: string; error: string }
      expect(body.code).toBe('VALIDATION_ERROR')
      expect(body.error).toBe('Invalid action')
    })

    it('POST /api/companies/bulk-action restore returns 200', async () => {
      ctx.selectQueue.push([])
      const res = await app.request('/api/companies/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['00000000-0000-0000-0000-000000000001'], action: 'restore' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { message: string; count: number }
      expect(body.count).toBe(1)
      expect(body.message).toContain('Restored')
    })

    it('GET /api/companies/export returns CSV with proper headers', async () => {
      ctx.selectQueue.push([])
      const res = await app.request('/api/companies/export')
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/csv')
      expect(res.headers.get('Content-Disposition')).toMatch(/attachment/)
      const text = await res.text()
      // Route prepends UTF-8 BOM; undici may omit U+FEFF as first decoded char.
      const body = text.startsWith('\uFEFF') ? text.slice(1) : text
      expect(body).toMatch(/^Name,BIN,City,/)
    })
  })

  describe('Scrapers routes', () => {
    it('POST /api/scrapers/2gis returns 400 for invalid body', async () => {
      const res = await app.request('/api/scrapers/2gis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { code: string }
      expect(body.code).toBe('VALIDATION_ERROR')
    })

    it('POST /api/scrapers/2gis with valid body returns 202', async () => {
      ctx.selectQueue.push([])
      const res = await app.request('/api/scrapers/2gis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cities: ['Almaty'],
          categories: ['Cafe'],
        }),
      })
      expect(res.status).toBe(202)
      const body = (await res.json()) as { runId: string; message: string }
      expect(body.runId).toBe('11111111-1111-1111-1111-111111111111')
      expect(body.message).toBe('Scraper job started')
      expect(ctx.run2GisScraper).toHaveBeenCalledWith(
        expect.objectContaining({
          cities: ['Almaty'],
          categories: ['Cafe'],
          scraperRunId: '11111111-1111-1111-1111-111111111111',
        }),
      )
    })

    it('GET /api/scrapers/runs returns runs array', async () => {
      ctx.selectQueue.push([])
      const res = await app.request('/api/scrapers/runs')
      expect(res.status).toBe(200)
      const data = (await res.json()) as { runs: unknown[] }
      expect(Array.isArray(data.runs)).toBe(true)
    })

    it('GET /api/scrapers/runs/:id returns 404 for unknown run', async () => {
      ctx.selectQueue.push([])
      const res = await app.request('/api/scrapers/runs/00000000-0000-0000-0000-000000000099')
      expect(res.status).toBe(404)
      const body = (await res.json()) as { code: string }
      expect(body.code).toBe('NOT_FOUND')
    })

    it('GET /api/scrapers/runs/:id returns run row with banner stats (detailAttempts, totalSkipped, resultsCount)', async () => {
      const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      ctx.selectQueue.push([
        {
          id: runId,
          scraper: '2gis',
          status: 'running',
          resultsCount: 4,
          detailAttempts: 27,
          totalSkipped: 31,
          listPagesCompleted: 12,
          emptyPageStreakMax: 0,
          error: null,
          startedAt: new Date('2026-01-01T12:00:00.000Z'),
          completedAt: null,
        },
      ])
      ctx.selectQueue.push([{ n: 12 }])
      const res = await app.request(`/api/scrapers/runs/${runId}`)
      expect(res.status).toBe(200)
      const data = (await res.json()) as {
        detailAttempts: number
        totalSkipped: number
        resultsCount: number | null
        status: string
      }
      expect(data.status).toBe('running')
      expect(data.resultsCount).toBe(12)
      expect(data.detailAttempts).toBe(27)
      expect(data.totalSkipped).toBe(31)
    })
  })

  describe('Outreach routes', () => {
    it('GET /api/outreach/sequences returns YAML-backed sequence list', async () => {
      const res = await app.request('/api/outreach/sequences')
      expect(res.status).toBe(200)
      const data = (await res.json()) as { sequences: { key: string }[] }
      expect(Array.isArray(data.sequences)).toBe(true)
      expect(data.sequences.some((s) => s.key === 'cold_outreach')).toBe(true)
    })

    it('GET /api/outreach/business includes whatsapp_baileys_send and email_api_send', async () => {
      const res = await app.request('/api/outreach/business')
      expect(res.status).toBe(200)
      const data = (await res.json()) as { whatsapp_baileys_send?: boolean; email_api_send?: boolean }
      expect(typeof data.whatsapp_baileys_send).toBe('boolean')
      expect(typeof data.email_api_send).toBe('boolean')
    })

    it('POST /api/outreach/send returns 503 when Baileys send is disabled', async () => {
      const res = await app.request('/api/outreach/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: '00000000-0000-0000-0000-000000000001',
          sequenceKey: 'cold_outreach',
          stepIndex: 0,
        }),
      })
      expect(res.status).toBe(503)
      const body = (await res.json()) as { code: string }
      expect(body.code).toBe('WHATSAPP_BAILEYS_DISABLED')
    })

    it('POST /api/outreach/send returns 404 when lead is outside tenant scope', async () => {
      const prev = process.env.WHATSAPP_BAILEYS_ENABLED
      const prevTenant = process.env.DEFAULT_TENANT_ID
      process.env.WHATSAPP_BAILEYS_ENABLED = 'true'
      process.env.DEFAULT_TENANT_ID = 'a0000000-0000-4000-8000-000000000001'
      try {
        ctx.selectQueue.push([])
        const res = await app.request('/api/outreach/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId: '00000000-0000-0000-0000-000000000001',
            sequenceKey: 'cold_outreach',
            stepIndex: 0,
          }),
        })
        expect(res.status).toBe(404)
        const body = (await res.json()) as { code?: string }
        expect(body.code).toBe('NOT_FOUND')
      } finally {
        if (prev !== undefined) process.env.WHATSAPP_BAILEYS_ENABLED = prev
        else delete process.env.WHATSAPP_BAILEYS_ENABLED
        if (prevTenant !== undefined) process.env.DEFAULT_TENANT_ID = prevTenant
        else delete process.env.DEFAULT_TENANT_ID
      }
    })

    it('POST /api/outreach/schedule returns 503 when Baileys send is disabled', async () => {
      const res = await app.request('/api/outreach/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: '00000000-0000-0000-0000-000000000001',
          sequenceKey: 'cold_outreach',
          stepIndex: 0,
          delayMs: 3600000,
        }),
      })
      expect(res.status).toBe(503)
      const body = (await res.json()) as { code: string }
      expect(body.code).toBe('WHATSAPP_BAILEYS_DISABLED')
    })

    it('POST /api/outreach/send-email returns 503 when Resend is not configured', async () => {
      const prev = process.env.RESEND_API_KEY
      vi.stubEnv('RESEND_API_KEY', '')
      try {
        const res = await app.request('/api/outreach/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId: '00000000-0000-0000-0000-000000000001',
            sequenceKey: 'cold_outreach',
            stepIndex: 2,
          }),
        })
        expect(res.status).toBe(503)
        const body = (await res.json()) as { code: string }
        expect(body.code).toBe('EMAIL_API_DISABLED')
      } finally {
        if (prev !== undefined) process.env.RESEND_API_KEY = prev
        else delete process.env.RESEND_API_KEY
      }
    })

    it('GET /api/outreach/scripts returns 403 when no tenant (scripts require org)', async () => {
      const prev = process.env.DEFAULT_TENANT_ID
      process.env.DEFAULT_TENANT_ID = ''
      try {
        const res = await app.request('/api/outreach/scripts')
        expect(res.status).toBe(403)
        const body = (await res.json()) as { code?: string }
        expect(body.code).toBe('TENANT_REQUIRED')
      } finally {
        if (prev !== undefined) process.env.DEFAULT_TENANT_ID = prev
        else delete process.env.DEFAULT_TENANT_ID
      }
    })

    it('GET /api/outreach/scripts returns merged YAML sequences when tenant is resolved', async () => {
      /** Must satisfy tenant middleware UUID_RE (RFC variant/version nibble). */
      const tid = 'a0000000-0000-4000-8000-000000000001'
      const prevDefault = process.env.DEFAULT_TENANT_ID
      // Root .env may load after hoisted stubs; set process.env so tenant middleware sees the UUID.
      process.env.DEFAULT_TENANT_ID = tid
      try {
        // tenant middleware: lookup tenants by id
        ctx.selectQueue.push([
          {
            id: tid,
            name: 'Vitest Tenant',
            slug: 'vitest',
            active: true,
            icpConfig: {},
            ownerId: null,
            stripeSubscriptionId: null,
            stripeCustomerId: null,
            exportsUsed: 0,
            quotaResetAt: null,
            trialEndsAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          },
        ])
        // GET /scripts: override keys for tenant
        ctx.selectQueue.push([])
        // getMergedSequencesForTenant: outreach_sequence_defs rows
        ctx.selectQueue.push([])

        const res = await app.request('/api/outreach/scripts')
        expect(res.status).toBe(200)
        const data = (await res.json()) as {
          sequences: Array<{ key: string; isOverridden?: boolean }>
        }
        expect(data.sequences.some((s) => s.key === 'cold_outreach')).toBe(true)
        expect(data.sequences.find((s) => s.key === 'cold_outreach')?.isOverridden).toBe(false)
      } finally {
        if (prevDefault !== undefined) process.env.DEFAULT_TENANT_ID = prevDefault
        else delete process.env.DEFAULT_TENANT_ID
      }
    })

    it('POST /api/outreach/sequences/start returns 403 when tenant is unresolved', async () => {
      const prev = process.env.DEFAULT_TENANT_ID
      process.env.DEFAULT_TENANT_ID = ''
      try {
        const res = await app.request('/api/outreach/sequences/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId: '00000000-0000-0000-0000-000000000001' }),
        })
        expect(res.status).toBe(403)
        const body = (await res.json()) as { code?: string }
        expect(body.code).toBe('TENANT_REQUIRED')
      } finally {
        if (prev !== undefined) process.env.DEFAULT_TENANT_ID = prev
        else delete process.env.DEFAULT_TENANT_ID
      }
    })

    it('POST /api/outreach/webhook/resend-inbound returns 401 when secret mismatches', async () => {
      const prev = process.env.RESEND_INBOUND_WEBHOOK_SECRET
      process.env.RESEND_INBOUND_WEBHOOK_SECRET = 'expected-secret'
      try {
        const res = await app.request('/api/outreach/webhook/resend-inbound', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-leadiya-webhook-secret': 'wrong-secret' },
          body: JSON.stringify({ from: 'lead@example.com', text: 'Hello' }),
        })
        expect(res.status).toBe(401)
      } finally {
        if (prev !== undefined) process.env.RESEND_INBOUND_WEBHOOK_SECRET = prev
        else delete process.env.RESEND_INBOUND_WEBHOOK_SECRET
      }
    })

    it('POST /api/outreach/webhook/resend-inbound accepts matching secret header', async () => {
      const prev = process.env.RESEND_INBOUND_WEBHOOK_SECRET
      process.env.RESEND_INBOUND_WEBHOOK_SECRET = 'expected-secret'
      try {
        ctx.selectQueue.push([])
        const res = await app.request('/api/outreach/webhook/resend-inbound', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-leadiya-webhook-secret': 'expected-secret' },
          body: JSON.stringify({ from: 'lead@example.com', text: 'Hello' }),
        })
        expect(res.status).toBe(200)
      } finally {
        if (prev !== undefined) process.env.RESEND_INBOUND_WEBHOOK_SECRET = prev
        else delete process.env.RESEND_INBOUND_WEBHOOK_SECRET
      }
    })
  })

  describe('Error handling', () => {
    it('unknown routes under /api/* return 404', async () => {
      const res = await app.request('/api/definitely-not-a-defined-route-xyz')
      expect(res.status).toBe(404)
    })
  })
})

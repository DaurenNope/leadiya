import { describe, it, expect, vi, beforeEach } from 'vitest'

const ctx = vi.hoisted(() => {
  let processor: ((job: any, token?: string) => Promise<unknown>) | null = null

  const moveToDelayed = vi.fn().mockResolvedValue(undefined)
  const sendMessage = vi.fn().mockResolvedValue(undefined)
  const setInboundHandler = vi.fn()
  const initLegacyConnection = vi.fn()
  const logWaAgent = vi.fn()

  const waRedis = {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    decr: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ status: 'cold' }])),
          })),
        })),
      })),
    })),
  }

  class WorkerMock {
    constructor(_name: string, fn: (job: any, token?: string) => Promise<unknown>) {
      processor = fn
    }
    on() {
      return this
    }
  }

  class DelayedErrorMock extends Error {}

  return {
    getProcessor: () => processor,
    WorkerMock,
    DelayedErrorMock,
    moveToDelayed,
    sendMessage,
    setInboundHandler,
    initLegacyConnection,
    logWaAgent,
    waRedis,
    db,
  }
})

vi.mock('bullmq', () => ({
  Worker: ctx.WorkerMock,
  DelayedError: ctx.DelayedErrorMock,
}))

vi.mock('@leadiya/queue', () => ({
  QueueName: { WHATSAPP_OUTREACH: 'whatsapp_outreach' },
  connection: {},
}))

vi.mock('@leadiya/config', () => ({
  env: { NODE_ENV: 'test', WHATSAPP_MIN_SEND_GAP_MS: 0, WHATSAPP_MAX_SEND_GAP_JITTER_MS: 0 },
  isWhatsappBusinessHoursDisabled: vi.fn(() => true),
}))

vi.mock('@leadiya/db', () => ({
  db: ctx.db,
  leadSequenceState: { status: 'status', leadId: 'leadId', sequenceKey: 'sequenceKey', updatedAt: 'updatedAt' },
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
}))

vi.mock('../lib/whatsapp-pool.js', () => ({
  waRedis: ctx.waRedis,
  sendMessage: ctx.sendMessage,
  initLegacyConnection: ctx.initLegacyConnection,
  setInboundHandler: ctx.setInboundHandler,
}))

vi.mock('./sequence-engine.js', () => ({ handleInboundReply: vi.fn() }))
vi.mock('../lib/wa-agent-log.js', () => ({ logWaAgent: ctx.logWaAgent }))
vi.mock('../lib/whatsapp-business-hours.js', () => ({
  hourInTz: vi.fn(() => 12),
  isOutsideBusinessWindow: vi.fn(() => false),
  msUntilBusinessWindow: vi.fn(() => 1000),
}))

describe('whatsapp worker processor', async () => {
  await import('./whatsapp-baileys.worker.js')

  beforeEach(() => {
    vi.clearAllMocks()
    ctx.waRedis.incr.mockResolvedValue(1)
    ctx.waRedis.get.mockResolvedValue(null)
    ctx.db.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ status: 'cold' }])),
          })),
        })),
      })),
    } as any)
  })

  it('suppresses send when sequence is no longer active', async () => {
    const processor = ctx.getProcessor()
    expect(processor).toBeTypeOf('function')

    const job = {
      id: 'job-1',
      data: { leadId: 'lead-1', sequenceKey: 'cold_outreach', phoneDigits: '77001234567', body: 'hi', tenantId: 't1' },
      moveToDelayed: ctx.moveToDelayed,
    }
    const res = await processor!(job, 'token-1')
    expect(res).toEqual({ ok: true, skipped: true })
    expect(ctx.sendMessage).not.toHaveBeenCalled()
    expect(ctx.waRedis.decr).toHaveBeenCalledTimes(2)
  })

  it('sends when no sequence key provided', async () => {
    const processor = ctx.getProcessor()
    const job = {
      id: 'job-2',
      data: { leadId: 'lead-1', phoneDigits: '77001234567', body: 'hello', tenantId: 't1' },
      moveToDelayed: ctx.moveToDelayed,
    }
    await processor!(job, 'token-2')
    expect(ctx.sendMessage).toHaveBeenCalledTimes(1)
    expect(ctx.waRedis.set).toHaveBeenCalled()
  })
})

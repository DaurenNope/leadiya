import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const jobOptsBase = { removeOnComplete: 200, removeOnFail: 500 }

const { mockWhere, mockFrom, mockSelect, mockDb, mockLeads } = vi.hoisted(() => {
  const mockWhere = vi.fn()
  const mockFrom = vi.fn(() => ({ where: mockWhere }))
  const mockSelect = vi.fn(() => ({ from: mockFrom }))
  const mockDb = { select: mockSelect }
  const mockLeads = {
    id: 'leads.id',
    name: 'leads.name',
    source: 'leads.source',
    bin: 'leads.bin',
    website: 'leads.website',
    enrichmentSources: 'leads.enrichmentSources',
  }
  return { mockWhere, mockFrom, mockSelect, mockDb, mockLeads: mockLeads }
})

const { addWebsite, addStat, addUchet, addGoszakup, addTwogis } = vi.hoisted(() => ({
  addWebsite: vi.fn().mockResolvedValue(undefined),
  addStat: vi.fn().mockResolvedValue(undefined),
  addUchet: vi.fn().mockResolvedValue(undefined),
  addGoszakup: vi.fn().mockResolvedValue(undefined),
  addTwogis: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@leadiya/db', () => ({
  db: mockDb,
  leads: mockLeads,
  eq: vi.fn(),
}))

vi.mock('./queues.js', () => ({
  websiteEnrichQueue: { add: addWebsite },
  statEnrichQueue: { add: addStat },
  uchetEnrichQueue: { add: addUchet },
  goszakupEnrichQueue: { add: addGoszakup },
  twogisEnrichQueue: { add: addTwogis },
}))

import { enqueueEnrichmentForLeads } from './enqueue-enrichment.js'

describe('enqueueEnrichmentForLeads', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockWhere.mockReset()
    mockFrom.mockReset()
    mockSelect.mockReset()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  it('returns immediately for an empty lead id list without touching the DB query chain', async () => {
    await enqueueEnrichmentForLeads([])

    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockWhere).not.toHaveBeenCalled()
    expect(addWebsite).not.toHaveBeenCalled()
    expect(addStat).not.toHaveBeenCalled()
    expect(addUchet).not.toHaveBeenCalled()
    expect(addGoszakup).not.toHaveBeenCalled()
    expect(addTwogis).not.toHaveBeenCalled()
  })

  it('enqueues 2GIS search + all four sources when the lead has name, website and BIN and no enrichment yet', async () => {
    mockWhere.mockResolvedValue([
      {
        id: 'lead-full',
        name: 'Acme LLP',
        source: null,
        bin: '123456789012',
        website: 'https://example.com',
        enrichmentSources: null,
      },
    ])

    await enqueueEnrichmentForLeads(['lead-full'])

    expect(addTwogis).toHaveBeenCalledTimes(1)
    expect(addTwogis).toHaveBeenCalledWith(
      'enrich',
      { leadId: 'lead-full' },
      { ...jobOptsBase, jobId: 'twogis:lead-full' }
    )
    expect(addWebsite).toHaveBeenCalledTimes(1)
    expect(addWebsite).toHaveBeenCalledWith(
      'enrich',
      { leadId: 'lead-full', website: 'https://example.com' },
      { ...jobOptsBase, jobId: 'web:lead-full' }
    )
    expect(addStat).toHaveBeenCalledTimes(1)
    expect(addStat).toHaveBeenCalledWith(
      'enrich',
      { leadId: 'lead-full', bin: '123456789012' },
      { ...jobOptsBase, jobId: 'stat:lead-full' }
    )
    expect(addUchet).toHaveBeenCalledTimes(1)
    expect(addUchet).toHaveBeenCalledWith(
      'enrich',
      { leadId: 'lead-full', bin: '123456789012' },
      { ...jobOptsBase, jobId: 'uchet:lead-full' }
    )
    expect(addGoszakup).toHaveBeenCalledTimes(1)
    expect(addGoszakup).toHaveBeenCalledWith(
      'enrich',
      { leadId: 'lead-full', bin: '123456789012' },
      { ...jobOptsBase, jobId: 'gzk:lead-full' }
    )
  })

  it('skips the website queue when enrichmentSources already has website', async () => {
    mockWhere.mockResolvedValue([
      {
        id: 'lead-partial',
        name: 'Partial Co',
        source: 'goszakup',
        bin: '999888777666',
        website: 'https://has-site.com',
        enrichmentSources: { website: { scrapedAt: '2024-01-01' } },
      },
    ])

    await enqueueEnrichmentForLeads(['lead-partial'])

    expect(addTwogis).toHaveBeenCalledTimes(1)
    expect(addWebsite).not.toHaveBeenCalled()
    expect(addStat).toHaveBeenCalledTimes(1)
    expect(addUchet).toHaveBeenCalledTimes(1)
    expect(addGoszakup).toHaveBeenCalledTimes(1)
  })

  it('enqueues only BIN-backed sources when there is no website', async () => {
    mockWhere.mockResolvedValue([
      {
        id: 'lead-no-web',
        name: 'No Web LLC',
        source: 'stat',
        bin: '111222333444',
        website: null,
        enrichmentSources: {},
      },
    ])

    await enqueueEnrichmentForLeads(['lead-no-web'])

    expect(addTwogis).toHaveBeenCalledTimes(1)
    expect(addWebsite).not.toHaveBeenCalled()
    expect(addStat).toHaveBeenCalledTimes(1)
    expect(addUchet).toHaveBeenCalledTimes(1)
    expect(addGoszakup).toHaveBeenCalledTimes(1)
  })

  it('enqueues only the website job when there is a website but no BIN', async () => {
    mockWhere.mockResolvedValue([
      {
        id: 'lead-web-only',
        bin: null,
        website: 'https://only-web.kz',
        enrichmentSources: {},
      },
    ])

    await enqueueEnrichmentForLeads(['lead-web-only'])

    expect(addWebsite).toHaveBeenCalledTimes(1)
    expect(addStat).not.toHaveBeenCalled()
    expect(addUchet).not.toHaveBeenCalled()
    expect(addGoszakup).not.toHaveBeenCalled()
  })

  it('does not enqueue any job when all four enrichment sources are already present', async () => {
    mockWhere.mockResolvedValue([
      {
        id: 'lead-done',
        name: 'Done Inc',
        source: 'manual',
        bin: '555666777888',
        website: 'https://done.com',
        enrichmentSources: {
          website: true,
          stat: true,
          uchet: true,
          goszakup: true,
          twogisSearch: { status: 'ok' },
        },
      },
    ])

    await enqueueEnrichmentForLeads(['lead-done'])

    expect(addTwogis).not.toHaveBeenCalled()
    expect(addWebsite).not.toHaveBeenCalled()
    expect(addStat).not.toHaveBeenCalled()
    expect(addUchet).not.toHaveBeenCalled()
    expect(addGoszakup).not.toHaveBeenCalled()
  })

  it('dispatches the correct number of jobs across three leads with mixed enrichment state', async () => {
    mockWhere.mockResolvedValue([
      {
        id: 'a',
        name: 'A Co',
        source: null,
        bin: '100000000000',
        website: 'https://a.kz',
        enrichmentSources: {},
      },
      {
        id: 'b',
        name: 'B Co',
        source: null,
        bin: '200000000000',
        website: 'https://b.kz',
        enrichmentSources: { website: { ok: true } },
      },
      {
        id: 'c',
        name: 'C Co',
        source: null,
        bin: null,
        website: 'https://c.kz',
        enrichmentSources: {},
      },
    ])

    await enqueueEnrichmentForLeads(['a', 'b', 'c'])

    // a: twogis + 4; b: twogis + 3 BIN; c: twogis + website → total 11
    expect(addTwogis).toHaveBeenCalledTimes(3)
    expect(addWebsite).toHaveBeenCalledTimes(2)
    expect(addStat).toHaveBeenCalledTimes(2)
    expect(addUchet).toHaveBeenCalledTimes(2)
    expect(addGoszakup).toHaveBeenCalledTimes(2)

    const totalAdds =
      addTwogis.mock.calls.length +
      addWebsite.mock.calls.length +
      addStat.mock.calls.length +
      addUchet.mock.calls.length +
      addGoszakup.mock.calls.length
    expect(totalAdds).toBe(11)
  })

  it('does not enqueue 2GIS lookup for leads already sourced from 2GIS', async () => {
    mockWhere.mockResolvedValue([
      {
        id: 'from-2gis',
        name: 'Map Co',
        source: '2gis',
        bin: null,
        website: null,
        enrichmentSources: {},
      },
    ])

    await enqueueEnrichmentForLeads(['from-2gis'])

    expect(addTwogis).not.toHaveBeenCalled()
  })

  it('does not enqueue 2GIS lookup when the lead has no company name', async () => {
    mockWhere.mockResolvedValue([
      {
        id: 'no-name',
        name: null,
        source: 'stat',
        bin: '123456789012',
        website: null,
        enrichmentSources: {},
      },
    ])

    await enqueueEnrichmentForLeads(['no-name'])

    expect(addTwogis).not.toHaveBeenCalled()
    expect(addStat).toHaveBeenCalledTimes(1)
  })
})

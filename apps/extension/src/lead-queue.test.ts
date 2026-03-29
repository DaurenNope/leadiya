import { describe, expect, it } from 'vitest'
import { leadFingerprint, normalizeApiOrigin, pruneRecent, shouldEnqueueLead } from '../lib/lead-queue'

describe('lead-queue helpers', () => {
  it('dedupes same lead inside time window', () => {
    const recent = new Map<string, number>()
    const lead = { name: ' Acme ', city: 'Алматы', sourceUrl: 'https://2gis.kz/almaty/firm/1' }
    const t0 = 1_000
    expect(shouldEnqueueLead(lead, recent, t0, 10_000)).toBe(true)
    expect(shouldEnqueueLead(lead, recent, t0 + 5_000, 10_000)).toBe(false)
    expect(shouldEnqueueLead(lead, recent, t0 + 11_000, 10_000)).toBe(true)
  })

  it('prunes stale keys', () => {
    const recent = new Map<string, number>([
      ['a', 1000],
      ['b', 3000],
    ])
    pruneRecent(recent, 12_000, 10_000)
    expect(recent.has('a')).toBe(false)
    expect(recent.has('b')).toBe(true)
  })

  it('normalizes API origin', () => {
    expect(normalizeApiOrigin('localhost:3041/')).toBe('http://localhost:3041')
    expect(normalizeApiOrigin('https://api.example.com/path')).toBe('https://api.example.com')
    expect(normalizeApiOrigin('   ')).toBe(null)
  })

  it('fingerprint includes normalized key parts', () => {
    expect(
      leadFingerprint({
        name: ' Test ',
        city: ' Алматы ',
        sourceUrl: 'HTTPS://2GIS.KZ/ALMATY/FIRM/1 ',
      }),
    ).toBe('test|алматы|https://2gis.kz/almaty/firm/1')
  })
})


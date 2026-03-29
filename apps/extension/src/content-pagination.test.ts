import { describe, expect, test } from 'vitest'

function extractFirmLikeLinksFromHrefs(hrefs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of hrefs) {
    const href = raw.split('?')[0]
    if (!/\/(firm|geo)\//.test(href)) continue
    if (seen.has(href)) continue
    seen.add(href)
    out.push(href)
  }
  return out
}

describe('content pagination link extraction', () => {
  test('keeps both /firm and /geo links and dedupes', () => {
    const links = extractFirmLikeLinksFromHrefs([
      'https://2gis.kz/almaty/firm/70000001000001?m=1',
      'https://2gis.kz/almaty/firm/70000001000001?m=2',
      'https://2gis.kz/almaty/geo/70000001000002',
      'https://2gis.kz/almaty/search/кафе',
    ])
    expect(links).toEqual([
      'https://2gis.kz/almaty/firm/70000001000001',
      'https://2gis.kz/almaty/geo/70000001000002',
    ])
  })
})


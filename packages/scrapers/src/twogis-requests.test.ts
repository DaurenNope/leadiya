import { describe, expect, it } from 'vitest'
import { buildTwogisStartRequests } from './twogis.js'

describe('buildTwogisStartRequests', () => {
  it('expands city×category cross product', () => {
    const reqs = buildTwogisStartRequests({
      cities: ['Алматы', 'Астана'],
      categories: ['Кафе', 'Рестораны', 'ветеринарные клиники'],
      listStrategy: 'hybrid',
    })

    expect(reqs).toHaveLength(2 * 3)
    expect(reqs.map((r) => r.uniqueKey)).toContain('2gis|Алматы|Кафе')
    expect(reqs.map((r) => r.uniqueKey)).toContain('2gis|Астана|ветеринарные клиники')

    // URL encodes category tokens (custom categories behave the same as presets).
    expect(reqs.find((r) => r.uniqueKey === '2gis|Алматы|ветеринарные клиники')?.url).toBe(
      'https://2gis.kz/almaty/search/%D0%B2%D0%B5%D1%82%D0%B5%D1%80%D0%B8%D0%BD%D0%B0%D1%80%D0%BD%D1%8B%D0%B5%20%D0%BA%D0%BB%D0%B8%D0%BD%D0%B8%D0%BA%D0%B8',
    )
  })

  it('falls back to lowercased city slug if city not in CITY_SLUGS', () => {
    const reqs = buildTwogisStartRequests({
      cities: ['Pavlodar'],
      categories: ['Cafe'],
      listStrategy: 'hybrid',
    })
    expect(reqs[0]?.url).toBe('https://2gis.kz/pavlodar/search/Cafe')
  })
})


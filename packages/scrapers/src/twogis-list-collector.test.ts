import { describe, expect, it } from 'vitest'
import {
  citySlugFromSearchUrl,
  normalizeFirmUrl,
  normalizeFirmUrlForSearchCity,
} from './twogis-list-collector.js'

describe('normalizeFirmUrl', () => {
  it('strips tracking suffix from firm token', () => {
    const url =
      'https://2gis.kz/firm/70000001018638237_Am5spusidBdB9A827J8H1J2JHGIIG2G5A0Bdfuz339-c17d0'
    expect(normalizeFirmUrl(url)).toBe('https://2gis.kz/firm/70000001018638237')
  })

  it('keeps city-scoped firm urls canonical', () => {
    const url = 'https://2gis.kz/pavlodar/firm/70000001018638237/?m=1'
    expect(normalizeFirmUrl(url)).toBe('https://2gis.kz/pavlodar/firm/70000001018638237')
  })
})

describe('search city filtering', () => {
  it('extracts city slug from search URL', () => {
    expect(citySlugFromSearchUrl('https://2gis.kz/pavlodar/search/%D0%A4%D0%B8%D1%82')).toBe('pavlodar')
  })

  it('drops firm links from another city', () => {
    expect(normalizeFirmUrlForSearchCity('https://2gis.kz/astana/firm/70000001018638237', 'pavlodar')).toBe(null)
  })

  it('maps bare firm links into current city', () => {
    expect(normalizeFirmUrlForSearchCity('https://2gis.kz/firm/70000001018638237_abcd', 'pavlodar')).toBe(
      'https://2gis.kz/pavlodar/firm/70000001018638237'
    )
  })
})

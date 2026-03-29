import { describe, expect, test } from 'vitest'
import { buildSearchPageUrl } from '../lib/search-pagination'

describe('search pagination url builder', () => {
  test('adds /page/N when missing', () => {
    expect(buildSearchPageUrl('https://2gis.kz/almaty/search/Цветы', 2)).toBe(
      'https://2gis.kz/almaty/search/%D0%A6%D0%B2%D0%B5%D1%82%D1%8B/page/2'
    )
  })

  test('replaces existing /page/N', () => {
    expect(buildSearchPageUrl('https://2gis.kz/almaty/search/Цветы/page/2', 3)).toBe(
      'https://2gis.kz/almaty/search/%D0%A6%D0%B2%D0%B5%D1%82%D1%8B/page/3'
    )
  })

  test('normalizes page 1 to base search url', () => {
    expect(buildSearchPageUrl('https://2gis.kz/almaty/search/Цветы/page/5', 1)).toBe(
      'https://2gis.kz/almaty/search/%D0%A6%D0%B2%D0%B5%D1%82%D1%8B'
    )
  })

  test('drops hash and preserves query', () => {
    expect(buildSearchPageUrl('https://2gis.kz/almaty/search/Цветы?m=1#frag', 2)).toBe(
      'https://2gis.kz/almaty/search/%D0%A6%D0%B2%D0%B5%D1%82%D1%8B/page/2?m=1'
    )
  })
})


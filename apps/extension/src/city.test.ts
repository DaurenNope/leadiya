import { describe, expect, test } from 'vitest'
import { resolveCity, resolveCityFromAddress } from '../lib/city'

describe('resolveCity', () => {
  test('maps slug city to cyrillic', () => {
    expect(resolveCity('almaty')).toBe('Алматы')
    expect(resolveCity('ust_kamenogorsk')).toBe('Усть-Каменогорск')
  })

  test('keeps human city untouched', () => {
    expect(resolveCity('Семей')).toBe('Семей')
  })

  test('normalizes uppercase cyrillic city', () => {
    expect(resolveCity('АСТАНА')).toBe('Астана')
  })

  test('falls back for empty input', () => {
    expect(resolveCity('', undefined, null)).toBe('Не указан')
  })

  test('infers city from address string', () => {
    expect(resolveCityFromAddress('г. Астана, ул. Кабанбай батыра 12')).toBe('Астана')
  })
})


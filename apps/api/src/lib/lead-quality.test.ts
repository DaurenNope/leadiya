import { describe, expect, test } from 'vitest'
import { sanitizeLeadPayload } from './lead-quality'

describe('sanitizeLeadPayload', () => {
  test('normalizes city from slug and applies high-confidence name category override', () => {
    const out = sanitizeLeadPayload({
      name: 'Global Dent',
      city: 'almaty',
      category: 'Кафе',
      phones: ['+7 (707) 123-45-67'],
    })
    expect(out.city).toBe('Алматы')
    expect(out.category).toBe('Медицина')
    expect(out.quality.citySource).toBe('input')
    expect(out.phones[0]).toBe('+77071234567')
  })

  test('prefers city from address and detects mismatch', () => {
    const out = sanitizeLeadPayload({
      name: 'Test',
      city: 'Алматы',
      address: 'г. Астана, ул. Кабанбай батыра 12',
      category: '',
    })
    expect(out.city).toBe('Астана')
    expect(out.quality.flags).toContain('city_mismatch')
  })

  test('falls back category when garbage is provided', () => {
    const out = sanitizeLeadPayload({
      name: 'A',
      city: 'Астана',
      category: 'Android',
    })
    expect(out.category).toBe('Без категории')
    expect(out.quality.categorySource).toBe('fallback')
  })

  test('overrides stale category with high-confidence medical name signal', () => {
    const out = sanitizeLeadPayload({
      name: 'DR.BABUR DENTAL CLINIC',
      city: 'Алматы',
      category: 'Кафе',
    })
    expect(out.category).toBe('Медицина')
    expect(out.quality.flags).toContain('category_overridden_by_name')
  })

  test('overrides stale education category for obvious horeca names', () => {
    const out = sanitizeLeadPayload({
      name: 'Greenwich Bar',
      city: 'Алматы',
      category: 'Образование',
    })
    expect(out.category).toBe('Рестораны и бары')
    expect(out.quality.flags).toContain('category_overridden_by_name')
  })
})


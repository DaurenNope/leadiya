import { describe, expect, it } from 'vitest'
import { collectPhones, isPhoneRevealLabel } from '../lib/phones'

describe('collectPhones', () => {
  it('collects unique phones from tel links and body text', () => {
    const out = collectPhones(
      ['tel:+77078200011'],
      `
      Контакты
      +7 707 820 00 11
      +7 (727) 123-45-67
      +7 (727) 123-45-67
      `
    )
    expect(out).toEqual(['+77078200011', '+77271234567'])
  })

  it('ignores short and invalid phone-like fragments', () => {
    const out = collectPhones([], 'Код: 12345, рейтинг 4.8, номер +7 12')
    expect(out).toEqual([])
  })

  it('detects reveal phone labels', () => {
    expect(isPhoneRevealLabel('Показать телефоны')).toBe(true)
    expect(isPhoneRevealLabel('Show phone')).toBe(true)
    expect(isPhoneRevealLabel('Контакты')).toBe(false)
  })
})

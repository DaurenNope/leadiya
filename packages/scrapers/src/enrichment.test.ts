import { describe, it, expect } from 'vitest'
import {
  extractEmailsFromHtml,
  extractLinksFromHtml,
  isValidContact,
  normalizePhone,
  normalizeEmail,
  normalizeWebsiteUrl,
} from './enrichment.js'

describe('extractEmailsFromHtml', () => {
  it('extracts emails from mailto: links', () => {
    const html = '<a href="mailto:info@test.com">Contact</a>'
    expect(extractEmailsFromHtml(html, 'https://example.com')).toContain('info@test.com')
  })

  it('extracts emails from plain text', () => {
    const html = '<p>Write to sales@company.kz for inquiries</p>'
    const emails = extractEmailsFromHtml(html, 'https://example.com')
    expect(emails).toContain('sales@company.kz')
  })

  it('deduplicates emails', () => {
    const html = '<a href="mailto:info@test.com">A</a> <a href="mailto:info@test.com">B</a>'
    expect(extractEmailsFromHtml(html, 'https://example.com')).toHaveLength(1)
  })

  it('extracts multiple distinct emails', () => {
    const html = '<p>info@a.com sales@b.com support@c.kz</p>'
    const emails = extractEmailsFromHtml(html, 'https://example.com')
    expect(emails.length).toBeGreaterThanOrEqual(3)
  })
})

describe('extractLinksFromHtml', () => {
  it('extracts links with text', () => {
    const html = '<a href="https://wa.me/77001234567">WhatsApp</a>'
    const links = extractLinksFromHtml(html, 'https://example.com')
    expect(links.some(l => l.href.includes('wa.me'))).toBe(true)
  })

  it('resolves relative links', () => {
    const html = '<a href="/contacts">Contacts</a>'
    const links = extractLinksFromHtml(html, 'https://example.com')
    expect(links.some(l => l.href === 'https://example.com/contacts')).toBe(true)
  })

  it('returns empty for no links', () => {
    const html = '<p>No links here</p>'
    const links = extractLinksFromHtml(html, 'https://example.com')
    expect(links).toHaveLength(0)
  })
})

describe('isValidContact', () => {
  it('returns true for normal text', () => {
    expect(isValidContact('+77001234567')).toBe(true)
    expect(isValidContact('info@test.com')).toBe(true)
  })

  it('returns false for Kazakh garbage words', () => {
    expect(isValidContact('позвонить')).toBe(false)
    expect(isValidContact('забронировать столик')).toBe(false)
  })
})

describe('normalizePhone', () => {
  it('normalizes KZ phone numbers', () => {
    expect(normalizePhone('8 (700) 123-45-67')).toBe('+77001234567')
    expect(normalizePhone('+7 700 123 45 67')).toBe('+77001234567')
  })

  it('returns empty string for invalid phones', () => {
    expect(normalizePhone('abc')).toBe('')
    expect(normalizePhone('123')).toBe('')
  })
})

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com')
  })
})

describe('normalizeWebsiteUrl', () => {
  it('adds https for bare host', () => {
    expect(normalizeWebsiteUrl('example.kz')).toBe('https://example.kz')
  })

  it('unwraps link.2gis.com redirect to target site', () => {
    const wrapped =
      'https://link.2gis.com/4.2/x/aHR0cHM6Ly9leGFtcGxlLmNvbS8'
    expect(normalizeWebsiteUrl(wrapped).startsWith('https://example.com')).toBe(true)
  })
})

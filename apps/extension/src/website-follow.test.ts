import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectWebsiteContacts, normalizeWebsiteUrl } from '../lib/website-follow'

describe('website-follow', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes website URL', () => {
    expect(normalizeWebsiteUrl('example.com')).toBe('https://example.com/')
    expect(normalizeWebsiteUrl(' https://example.com/path ')).toBe('https://example.com/path')
    expect(normalizeWebsiteUrl('')).toBe(null)
  })

  it('returns error for invalid URL', async () => {
    const res = await collectWebsiteContacts('not a url')
    expect(res.visited).toBe(0)
    expect(res.error).toBeTruthy()
  })

  it('collects phones/emails from homepage + contact page', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://example.com/') {
        return {
          ok: true,
          status: 200,
          text: async () =>
            `<html><body>
              <a href="/contact">Contact</a>
              <div>Call us: +7 (777) 123-45-67</div>
            </body></html>`,
        }
      }
      if (url === 'https://example.com/contact') {
        return {
          ok: true,
          status: 200,
          text: async () =>
            `<html><body>
              <a href="mailto:hello@example.com">Email</a>
              <p>sales@example.com</p>
            </body></html>`,
        }
      }
      return { ok: false, status: 404, text: async () => '' }
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const res = await collectWebsiteContacts('example.com', { maxPages: 4, timeoutMs: 1000 })
    expect(res.error).toBeFalsy()
    expect(res.visited).toBeGreaterThanOrEqual(2)
    expect(res.emails).toContain('hello@example.com')
    expect(res.emails).toContain('sales@example.com')
    expect(res.phones.some((p) => p.includes('7771234567') || p.includes('+77771234567'))).toBe(true)
  })
})


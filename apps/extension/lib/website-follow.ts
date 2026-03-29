export type WebsiteFollowResult = {
  phones: string[]
  emails: string[]
  visited: number
  error?: string
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const PHONE_RE = /(?:\+?\d[\d()\-\s]{6,}\d)/g
const CONTACT_HINTS = ['contact', 'contacts', 'kontakt', 'kontakty', 'about', 'company']

function decode2GisRedirect(link: string): string {
  if (!link.includes('link.2gis.com') && !link.includes('link.2gis.ru')) return link
  try {
    const u = new URL(link)
    const parts = u.pathname.split('/')
    const last = parts[parts.length - 1]
    if (!last) return link
    let raw = ''
    try {
      raw = decodeURIComponent(escape(atob(last)))
    } catch {
      raw = atob(last)
    }
    const lines = raw
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => /^https?:\/\//i.test(x))
      .filter((x) => !x.includes('2gis.'))
    return lines[0] || link
  } catch {
    return link
  }
}

export function normalizeWebsiteUrl(raw: string): string | null {
  const trimmed = decode2GisRedirect(raw.trim())
  if (!trimmed) return null
  try {
    const prefixed = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const u = new URL(prefixed)
    return `${u.protocol}//${u.host}${u.pathname || '/'}`
  } catch {
    return null
  }
}

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, '')
}

function extractEmailsAndPhones(text: string): { emails: string[]; phones: string[] } {
  const emails = Array.from(new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase())))
  const phones = Array.from(
    new Set(
      (text.match(PHONE_RE) ?? [])
        .map((p) => normalizePhone(p))
        .filter((p) => p.length >= 9),
    ),
  )
  return { emails, phones }
}

function extractLinks(html: string, base: URL): URL[] {
  const links: URL[] = []
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = hrefRe.exec(html))) {
    const href = (m[1] || '').trim()
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue
    try {
      const u = new URL(href, base)
      if (u.origin !== base.origin) continue
      links.push(u)
    } catch {
      // ignore invalid links
    }
  }
  return links
}

function isContactLike(url: URL): boolean {
  const p = url.pathname.toLowerCase()
  return CONTACT_HINTS.some((h) => p.includes(h))
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,*/*;q=0.8',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

export async function collectWebsiteContacts(
  websiteUrl: string,
  opts?: { maxPages?: number; timeoutMs?: number },
): Promise<WebsiteFollowResult> {
  const maxPages = opts?.maxPages ?? 4
  const timeoutMs = opts?.timeoutMs ?? 6000
  const start = normalizeWebsiteUrl(websiteUrl)
  if (!start) return { phones: [], emails: [], visited: 0, error: 'Некорректный URL сайта' }

  const visited = new Set<string>()
  const queue: string[] = [start]
  const emails = new Set<string>()
  const phones = new Set<string>()

  try {
    while (queue.length > 0 && visited.size < maxPages) {
      const url = queue.shift()!
      if (visited.has(url)) continue
      visited.add(url)

      const html = await fetchText(url, timeoutMs)
      const { emails: em, phones: ph } = extractEmailsAndPhones(html)
      em.forEach((e) => emails.add(e))
      ph.forEach((p) => phones.add(p))

      const base = new URL(url)
      const links = extractLinks(html, base)
      // Prefer contact-like links first.
      links
        .sort((a, b) => Number(isContactLike(b)) - Number(isContactLike(a)))
        .forEach((u) => {
          const s = u.toString()
          if (!visited.has(s) && queue.length < maxPages * 3) queue.push(s)
        })
    }
    return {
      phones: Array.from(phones),
      emails: Array.from(emails),
      visited: visited.size,
    }
  } catch (err) {
    return {
      phones: Array.from(phones),
      emails: Array.from(emails),
      visited: visited.size,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}


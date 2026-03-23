import { chromium, type Browser } from 'playwright-core'
import * as cheerio from 'cheerio'
import { db, leads, contacts, eq } from '@leadiya/db'

const FETCH_TIMEOUT_MS = 25_000
const STAGE2_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/**
 * Normalizes a phone number to E.164 format for Kazakhstan (+7...)
 */
export function normalizePhone(phone: string): string {
  if (!phone || phone.includes('...')) return ''

  let digits = phone.replace(/[^\d]/g, '')

  if (!digits || digits.length < 10) return ''

  if (digits.length === 11 && digits.startsWith('8')) {
    digits = '7' + digits.substring(1)
  }

  if (digits.length === 10) {
    digits = '7' + digits
  }

  if (digits.length === 11 && digits.startsWith('7')) {
    return '+' + digits
  }

  if (digits.length === 12 && digits.startsWith('77')) {
    return '+' + digits.substring(1)
  }

  if (digits.length >= 11 && digits.length <= 15) {
    return '+' + digits
  }

  return ''
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

export function isValidContact(value: string): boolean {
  const garbage = ['позвонить', 'забронировать', 'столик', 'написать', 'заказать']
  const lower = value.toLowerCase()
  return !garbage.some((g) => lower.includes(g))
}

export function decode2GisLink(link: string): string {
  if (!link) return ''
  if (link.includes('link.2gis.com')) {
    try {
      const b64 = link.split('/').pop()?.split('?')[0] || ''
      const decoded = Buffer.from(b64, 'base64').toString('utf-8')
      if (decoded.startsWith('http')) return decoded.split('\n')[0]
    } catch {
      /* ignore */
    }
  }
  return link
}

export function cleanSocial(type: 'ig' | 'wa' | 'tg', urls: string[]): string | null {
  if (!urls?.length) return null
  for (let url of urls) {
    try {
      url = decode2GisLink(url)
      const lowerUrl = url.toLowerCase()

      if (type === 'ig') {
        if (lowerUrl.includes('instagram.com/whatsapp')) continue
        if (lowerUrl.includes('instagram.com/taplink')) continue
        if (lowerUrl === 'https://instagram.com/' || lowerUrl === 'https://www.instagram.com/') continue
        return url
      }
      if (type === 'wa') {
        const match = url.match(/phone=([0-9]+)/)
        if (match) return `https://wa.me/${match[1]}`
        return url
      }
      if (type === 'tg') {
        if (lowerUrl.includes('t.me/taplink')) continue
        return url
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

export function normalizeWebsiteUrl(website: string): string {
  const t = website.trim()
  return t.startsWith('http') ? t : `https://${t}`
}

/** Extract mailto + body regex emails from HTML. */
export function extractEmailsFromHtml(html: string, pageUrl: string): string[] {
  const fromRegex = html.match(EMAIL_REGEX) || []
  const set = new Set<string>()
  for (const e of fromRegex.map(normalizeEmail)) {
    if (e && isValidContact(e)) set.add(e)
  }

  const $ = cheerio.load(html)
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || ''
    const raw = href.replace(/^mailto:/i, '').split('?')[0].trim()
    if (raw.includes('@')) {
      const n = normalizeEmail(raw)
      if (isValidContact(n)) set.add(n)
    }
  })

  return [...set]
}

export function extractLinksFromHtml(html: string, pageUrl: string): { href: string; text: string }[] {
  const $ = cheerio.load(html)
  const out: { href: string; text: string }[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return
    try {
      const absolute = new URL(href, pageUrl).href
      out.push({
        href: absolute,
        text: $(el).text().trim().toLowerCase(),
      })
    } catch {
      /* skip bad URL */
    }
  })
  return out
}

function pickContactLink(links: { href: string; text: string }[]) {
  return links.find(
    (l) =>
      l.text.includes('contact') ||
      l.text.includes('контакт') ||
      l.text.includes('связь') ||
      l.text.includes('о нас') ||
      l.text.includes('about')
  )
}

const HTTP_MAX_RETRIES = 2

async function fetchHtmlOnce(url: string): Promise<{ ok: boolean; status: number; html: string; error?: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': STAGE2_UA,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
    })
    const html = await res.text()
    return { ok: res.ok, status: res.status, html }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, status: 0, html: '', error: msg }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status: number; html: string; error?: string }> {
  for (let attempt = 0; attempt <= HTTP_MAX_RETRIES; attempt++) {
    const result = await fetchHtmlOnce(url)
    if (result.ok) return result
    const isRetryable = result.status === 0 || result.status >= 500
    if (!isRetryable || attempt === HTTP_MAX_RETRIES) return result
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
  }
  return { ok: false, status: 0, html: '', error: 'max retries' }
}

async function persistEnrichment(
  leadId: string,
  allEmails: { email: string; sourceUrl: string }[],
  whatsapp: string | null,
  instagram: string | null,
  telegram: string | null
) {
  const existing = await db.select({ enrichmentSources: leads.enrichmentSources }).from(leads).where(eq(leads.id, leadId)).limit(1)
  const prev = (existing[0]?.enrichmentSources ?? {}) as Record<string, unknown>

  await db
    .update(leads)
    .set({
      discoveryLevel: 2,
      whatsapp: whatsapp || null,
      instagram: instagram || null,
      telegram: telegram || null,
      enrichmentSources: {
        ...prev,
        website: { at: new Date().toISOString(), status: 'ok', emails: allEmails.length },
      },
      lastEnrichedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId))

  if (allEmails.length > 0) {
    for (const entry of allEmails) {
      const dup = await db.select().from(contacts).where(eq(contacts.email, entry.email))
      if (dup.length === 0) {
        await db.insert(contacts).values({
          leadId,
          email: entry.email,
          source: 'website_discovery',
          sourceUrl: entry.sourceUrl,
          isPrimary: false,
        })
      }
    }
  }
}

type ScanResult = { emails: string[]; links: { href: string; text: string }[] }

function mergeEmails(
  target: { email: string; sourceUrl: string }[],
  emails: string[],
  sourceUrl: string
) {
  for (const e of emails) {
    if (!target.some((x) => x.email === e)) {
      target.push({ email: e, sourceUrl })
    }
  }
}

function socialsFromLinks(links: { href: string; text: string }[]) {
  const hrefs = links.map((l) => l.href)
  const waUrls = hrefs.filter((l) => l.includes('wa.me') || l.includes('whatsapp.com') || l.includes('api.whatsapp.com'))
  const igUrls = hrefs.filter((l) => l.includes('instagram.com'))
  const tgUrls = hrefs.filter((l) => l.includes('t.me'))
  return {
    whatsappUrl: cleanSocial('wa', waUrls),
    instagramUrl: cleanSocial('ig', igUrls),
    telegramUrl: cleanSocial('tg', tgUrls),
  }
}

async function scanHttpPage(url: string): Promise<{ result: ScanResult; error?: string }> {
  const { ok, status, html, error } = await fetchHtml(url)
  if (!ok) {
    return {
      result: { emails: [], links: [] },
      error: error || `HTTP ${status || 'error'}`,
    }
  }
  if (!html || html.length < 50) {
    return { result: { emails: [], links: [] }, error: 'empty or tiny body' }
  }
  const emails = extractEmailsFromHtml(html, url)
  const links = extractLinksFromHtml(html, url)
  return { result: { emails, links } }
}

/**
 * Stage 2 via HTTP only (no browser). Returns success:false if fetch/parse insufficient.
 */
export async function enrichLeadWithWebsiteHttp(leadId: string, website: string): Promise<{
  success: boolean
  error?: string
  emails?: { email: string; sourceUrl: string }[]
}> {
  const targetUrl = normalizeWebsiteUrl(website)
  console.log(`[Stage 2:HTTP] ${leadId} → ${targetUrl}`)

  const allEmails: { email: string; sourceUrl: string }[] = []
  const home = await scanHttpPage(targetUrl)
  if (home.error && !home.result.links.length && !home.result.emails.length) {
    return { success: false, error: home.error }
  }

  mergeEmails(allEmails, home.result.emails, targetUrl)

  const allLinkRows = [...home.result.links]
  const contact = pickContactLink(home.result.links)
  if (contact?.href.startsWith('http')) {
    console.log(`[Stage 2:HTTP] Sub-page: ${contact.text} (${contact.href})`)
    const sub = await scanHttpPage(contact.href)
    mergeEmails(allEmails, sub.result.emails, contact.href)
    allLinkRows.push(...sub.result.links)
  }

  const { whatsappUrl, instagramUrl, telegramUrl } = socialsFromLinks(allLinkRows)

  const leadRecord = await db.query.leads.findFirst({
    where: eq(leads.id, leadId),
  })

  const whatsapp = whatsappUrl || leadRecord?.whatsapp || null
  const instagram = instagramUrl || leadRecord?.instagram || null
  const telegram = telegramUrl || leadRecord?.telegram || null

  console.log(`[Stage 2:HTTP] Aggregated for ${leadId}:`, {
    emailsCount: allEmails.length,
    whatsapp,
    instagram,
    telegram,
  })

  await persistEnrichment(leadId, allEmails, whatsapp, instagram, telegram)
  return { success: true, emails: allEmails }
}

/**
 * Stage 2: Playwright fallback (JS-heavy sites, blocks, etc.)
 */
export async function enrichLeadWithWebsitePlaywright(leadId: string, website: string) {
  const targetUrl = normalizeWebsiteUrl(website)
  console.log(`[Stage 2:Playwright] ${leadId} → ${targetUrl}`)

  let browser: Browser | undefined
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    const page = await context.newPage()
    page.setDefaultTimeout(30000)

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)

    const scanResult = async () => {
      const content = await page.content()
      const emails = extractEmailsFromHtml(content, page.url())
      const linkEls = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a')).map((a) => ({
          href: (a as HTMLAnchorElement).href,
          text: a.textContent?.trim().toLowerCase() || '',
        }))
      })
      return { emails, links: linkEls }
    }

    const homepage = await scanResult()
    let allEmails: { email: string; sourceUrl: string }[] = homepage.emails.map((e) => ({
      email: e,
      sourceUrl: targetUrl,
    }))

    const contactLink = pickContactLink(homepage.links)
    if (contactLink && contactLink.href.startsWith('http')) {
      console.log(`[Stage 2:Playwright] Sub-page: ${contactLink.text} (${contactLink.href})`)
      await page.goto(contactLink.href, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)
      const contactPage = await scanResult()
      contactPage.emails.forEach((e) => {
        if (!allEmails.find((ae) => ae.email === e)) {
          allEmails.push({ email: e, sourceUrl: contactLink.href })
        }
      })
    }

    const allLinks = homepage.links.map((l) => l.href)
    const waUrls = allLinks.filter((l) => l.includes('wa.me') || l.includes('whatsapp.com') || l.includes('api.whatsapp.com'))
    const igUrls = allLinks.filter((l) => l.includes('instagram.com'))
    const tgUrls = allLinks.filter((l) => l.includes('t.me'))

    const whatsappUrl = cleanSocial('wa', waUrls)
    const instagramUrl = cleanSocial('ig', igUrls)
    const telegramUrl = cleanSocial('tg', tgUrls)

    const leadRecord = await db.query.leads.findFirst({
      where: eq(leads.id, leadId),
    })

    const whatsapp = whatsappUrl || leadRecord?.whatsapp || null
    const instagram = instagramUrl || leadRecord?.instagram || null
    const telegram = telegramUrl || leadRecord?.telegram || null

    console.log(`[Stage 2:Playwright] Aggregated for ${leadId}:`, {
      emailsCount: allEmails.length,
      whatsapp,
      instagram,
      telegram,
    })

    await persistEnrichment(leadId, allEmails, whatsapp, instagram, telegram)
    return { success: true, emails: allEmails, socials: { whatsapp, instagram, telegram } }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[Stage 2:Playwright] Error enriching ${leadId}:`, message)
    return { success: false, error: message }
  } finally {
    if (browser) await browser.close()
  }
}

/**
 * Stage 2: HTTP first (fast), Playwright fallback unless `STAGE2_HTTP_ONLY=1`.
 */
export async function enrichLeadWithWebsite(leadId: string, website: string) {
  try {
    const http = await enrichLeadWithWebsiteHttp(leadId, website)
    if (http.success) return { success: true as const, emails: http.emails, via: 'http' as const }

    if (process.env.STAGE2_HTTP_ONLY === '1') {
      console.warn(`[Stage 2] HTTP-only mode; skipping Playwright for ${leadId}: ${http.error}`)
      return { success: false as const, error: http.error, via: 'http' as const }
    }

    console.log(`[Stage 2] HTTP incomplete (${http.error}), Playwright fallback`)
    return enrichLeadWithWebsitePlaywright(leadId, website)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { success: false as const, error: message }
  }
}

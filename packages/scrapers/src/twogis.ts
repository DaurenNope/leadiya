import { chromium } from 'playwright-extra'
import type { Page } from 'playwright'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { Configuration, PlaywrightCrawler } from 'crawlee'
import pRetry, { AbortError } from 'p-retry'
import { createHash } from 'node:crypto'
import { db, leads, contacts, scraperRuns, eq, inArray } from '@leadiya/db'
import { sql } from 'drizzle-orm'
import { env } from '@leadiya/config'
import { TWOGIS_DEFAULT_CATEGORIES } from '@leadiya/types'
import { 
  isValidContact, 
  normalizePhone, 
  normalizeEmail, 
} from './enrichment.js'
import {
  formatListMetricsLog,
  normalizeFirmUrl,
  runSearchListPhase,
  type TwogisListStrategy,
} from './twogis-list-collector.js'
import { normalizeSliceStats, type TwogisSliceStats } from './twogis-stats.js'
import {
  buildCheckpoint,
  checkpointFilePath,
  clearCheckpoint,
  defaultCheckpointDirectory,
  loadCheckpoint,
  saveCheckpoint,
} from './twogis-checkpoint.js'

chromium.use(StealthPlugin())

// ─── Configuration ───────────────────────────────────────────────────────────

const CITIES: string[] = [
  'Алматы', 'Астана', 'Шымкент', 'Актобе', 'Караганда', 
  'Тараз', 'Усть-Каменогорск', 'Костанай', 'Павлодар'
]

// Broad regex covering all common KZ/RU phone formats:
// +7 7xx xxx xx xx, +7 (7xx) xxx-xx-xx, 8 7xx xxx xx xx, +7xxxxxxxxxx, etc.
const PHONE_REGEX = /(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

// Retry settings
const DETAIL_RETRIES = 3
const DETAIL_MIN_TIMEOUT = 3000

// ─── Anti-detection ──────────────────────────────────────────────────────────

const REALISTIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const VIEWPORT = { width: 1920, height: 1080 }

const CLIENT_HINT_HEADERS: Record<string, string> = {
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-CH-UA': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
}

function buildProxyUrl(): string | null {
  const user = env.SMARTPROXY_USER
  const pass = env.SMARTPROXY_PASS
  if (!user || !pass) return null

  const u = user.toLowerCase().trim()
  const p = pass.toLowerCase().trim()
  /** Repo `.env` uses placeholder values until you paste real creds. */
  if (u.includes('placeholder') || p.includes('placeholder')) {
    console.warn(
      '[2GIS] SmartProxy credentials look like placeholders — disabling proxy. Set SMARTPROXY_USER/SMARTPROXY_PASS to real values or use Direct connection.',
    )
    return null
  }

  // Encode user/pass so special chars (like `@`) don't break the proxy URL.
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@gate.smartproxy.com:7000`
}

const MAX_CONSECUTIVE_CAPTCHAS = 3
const CAPTCHA_BACKOFF_MIN_MS = 30_000
const CAPTCHA_BACKOFF_MAX_MS = 60_000

// 2GIS city slugs for paginated URLs (https://2gis.kz/{slug}/search/{query}/page/{n})
const CITY_SLUGS: Record<string, string> = {
  'Алматы': 'almaty',
  'Астана': 'astana',
  'Шымкент': 'shymkent',
  'Актобе': 'aktobe',
  'Караганда': 'karaganda',
  'Тараз': 'taraz',
  'Усть-Каменогорск': 'ust-kamenogorsk',
  'Костанай': 'kostanay',
  'Павлодар': 'pavlodar',
}

/** Max consecutive empty pages before stopping. */
const MAX_EMPTY_PAGES = 3

/** One route handler per page — Crawlee calls preNavigationHooks every goto; stacking handlers leaks memory and slows routing. */
const heavyResourcesBlocked = new WeakSet<Page>()

/** Drop heavy resources so the first hop to 2GIS finishes; list phase does its own full load. */
async function blockHeavyResourcesOnPage(page: Page): Promise<void> {
  if (heavyResourcesBlocked.has(page)) return
  heavyResourcesBlocked.add(page)
  await page.route('**/*', (route) => {
    const t = route.request().resourceType()
    if (t === 'image' || t === 'media' || t === 'font') return route.abort()
    return route.continue()
  })
}

// ─── Deduplication ───────────────────────────────────────────────────────────

/**
 * Generate a deterministic UUID from company name + city.
 * This ensures the same company in the same city always gets the same ID,
 * preventing duplicates across runs.
 */
function deterministicId(name: string, city: string): string {
  const seed = `${name.toLowerCase().trim()}|${city.toLowerCase().trim()}`
  const hash = createHash('sha256').update(seed).digest('hex').substring(0, 32)
  return hash.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
}

/**
 * Check if a lead with this name already exists in the given city.
 * Uses case-insensitive matching.
 */
async function leadExists(name: string, city: string): Promise<boolean> {
  const existing = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      sql`LOWER(TRIM(${leads.name})) = LOWER(TRIM(${name})) AND LOWER(TRIM(${leads.city})) = LOWER(TRIM(${city}))`
    )
    .limit(1)
  return existing.length > 0
}

/** One IN-query per page chunk — avoids one round-trip per firm on duplicate-heavy pages. */
const SOURCE_URL_LOOKUP_CHUNK = 160

async function loadExistingSourceUrlsSet(urls: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const uniq = [...new Set(urls.map((u) => normalizeFirmUrl(u.trim())).filter(Boolean))]
  for (let i = 0; i < uniq.length; i += SOURCE_URL_LOOKUP_CHUNK) {
    const chunk = uniq.slice(i, i + SOURCE_URL_LOOKUP_CHUNK)
    const rows = await db
      .select({ sourceUrl: leads.sourceUrl })
      .from(leads)
      .where(inArray(leads.sourceUrl, chunk))
    for (const r of rows) {
      if (r.sourceUrl) out.add(normalizeFirmUrl(r.sourceUrl))
    }
  }
  return out
}

// ─── Phone Unmasking ─────────────────────────────────────────────────────────

async function unmaskPhone(page: Page) {
  try {
    const root = page.locator('main').first()
    const inMain = (await root.count()) > 0
    const ctx = inMain ? root : page.locator('body')
    const selectors = [
      'button:has-text("Показать телефон")',
      'button:has-text("Показать контакты")',
      'button:has-text("Показать")',
      '[class*="phone"] button',
      '._1sc716s button',
    ]

    for (const selector of selectors) {
      const loc = ctx.locator(selector)
      const n = await loc.count()
      for (let i = 0; i < n; i++) {
        await loc.nth(i).click({ force: true }).catch(() => {})
      }
    }

    await ctx.locator('a[href^="tel:"]').first().waitFor({ timeout: 3000 }).catch(() => {})
  } catch {
    // Silently continue — phone unmasking is best-effort
  }
}

/** 2GIS firm pages are a SPA; wait until URL + main card match before reading DOM (avoids stale phones/titles). */
async function waitForFirmCardShell(page: Page, firmUrl: string): Promise<void> {
  const id = firmUrl.match(/\/firm\/([^/?#]+)/)?.[1]
  if (id) {
    await page
      .waitForFunction((firmId) => window.location.pathname.includes(firmId), id, { timeout: 25_000 })
      .catch(() => {})
  }
  const h = page.locator('main h1, [role="main"] h1, article h1, h1').first()
  await h.waitFor({ state: 'visible', timeout: 25_000 })
}

// ─── Detail Page Scraping (with retry) ───────────────────────────────────────

/** Firm URLs copied from search often include huge `?stat=` tracking params — strip for a stable card DOM. */
function canonical2gisFirmUrl(url: string): string {
  try {
    const u = new URL(url.trim())
    if (!u.hostname.includes('2gis.')) return url.trim()
    u.search = ''
    let s = u.href
    if (s.endsWith('/')) s = s.slice(0, -1)
    return s
  } catch {
    return url.trim()
  }
}

export async function scrapeCompanyDetail(page: Page, url: string): Promise<any> {
  return pRetry(async (attemptNumber) => {
    const targetUrl = canonical2gisFirmUrl(url)
    console.log(`  → Navigating to: ${targetUrl}`)
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 60_000 })
    await waitForFirmCardShell(page, targetUrl)
    await page.waitForTimeout(250 + Math.random() * 350)

    await unmaskPhone(page)
    
    const details: any = await page.evaluate(`(() => {
      function pickCardRoot() {
        const m = document.querySelector('main');
        if (m) return m;
        const h = document.querySelector('h1');
        if (h) {
          const art = h.closest('article');
          if (art) return art;
        }
        return document.body;
      }
      const card = pickCardRoot();
      const getText = (s) => card.querySelector(s)?.textContent?.trim() || '';
      const getLinks = (s) =>
        Array.from(card.querySelectorAll(s)).map((el) => el.href || el.textContent?.trim()).filter(Boolean);

      const decode2Gis = (link) => {
        if (!link) return '';
        if (!link.includes('link.2gis.com') && !link.includes('link.2gis.ru')) return link;
        try {
          const url = new URL(link);
          const pathParts = url.pathname.split('/');
          const b64 = pathParts[pathParts.length - 1];
          if (!b64) return link;
          let raw = '';
          try { raw = decodeURIComponent(escape(atob(b64))); } catch(e) { raw = atob(b64); }
          const lines = raw.split('\\n').filter(l => l.startsWith('http'));
          return lines[0] || link;
        } catch(e) { return link; }
      };

      const cleanSocial = (type, urls) => {
        if (!urls || !urls.length) return null;
        for (let url of urls) {
          try {
            url = decode2Gis(url);
            const lowerUrl = url.toLowerCase();
            if (type === 'ig') {
              if (lowerUrl.includes('instagram.com/whatsapp')) continue;
              if (lowerUrl.includes('instagram.com/taplink')) continue;
              if (lowerUrl === 'https://instagram.com/' || lowerUrl === 'https://www.instagram.com/') continue;
              return url;
            }
            if (type === 'wa') {
              const match = url.match(/phone=([0-9]+)/);
              if (match) return 'https://wa.me/' + match[1];
              return url;
            }
            if (type === 'tg') {
              if (lowerUrl.includes('t.me/taplink')) continue;
              return url;
            }
            return url;
          } catch(e) {}
        }
        return null;
      };

      const igLinks = getLinks('a[href*="instagram.com"]');
      const waLinks = getLinks('a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="api.whatsapp.com"]');
      const tgLinks = getLinks('a[href*="t.me"]');
      const fbLinks = getLinks('a[href*="facebook.com"]');
      const vkLinks = getLinks('a[href*="vk.com"]');
      const twLinks = getLinks('a[href*="twitter.com"], a[href*="x.com"]');
      const ytLinks = getLinks('a[href*="youtube.com"]');

      // Website: find the first external link (2gis redirects) and decode it
      const websiteRaw = getLinks('a[href*="link.2gis.com"]:not([aria-label])')[0]
        || getLinks('a[href*="link.2gis.ru"]:not([aria-label])')[0]
        || '';
      const website = decode2Gis(websiteRaw);

      // Rating: scan card only (avoid sidebar / previous-route nodes in SPA)
      let ratingNum = null;
      let reviewsNum = null;
      const allSpans = card.querySelectorAll('div, span');
      for (const el of allSpans) {
        const t = el.textContent?.trim() || '';
        // Rating is a short element with just a float like "4.8" or "3.2"
        if (!ratingNum && /^[1-5]\\.[0-9]$/.test(t)) {
          ratingNum = parseFloat(t);
        }
        // Reviews count like "123 отзыва" or "45 reviews"
        if (!reviewsNum) {
          const rm = t.match(/^(\\d{1,6})\\s*(отзывов|отзыва|отзыв|reviews?)\\b/i);
          if (rm) reviewsNum = parseInt(rm[1], 10);
        }
        if (ratingNum && reviewsNum) break;
      }

      const bodyText = card.innerText || '';
      const binMatch = bodyText.match(/(?:БИН|BIN|ИИН|IIN)[:\\s]*([0-9]{12})/);

      function collectCardCategories() {
        const parts = [];
        const seen = new Set();
        const zw = /\u200b/g;
        const add = (s) => {
          let t = (s || '').replace(zw, '').replace(/\\s+/g, ' ').trim();
          if (!t || t.length > 200) return;
          const k = t.toLowerCase();
          if (k === 'подробнее' || k === '2гис' || k === '2gis' || k === 'на карте') return;
          if (seen.has(k)) return;
          seen.add(k);
          parts.push(t);
        };
        /** Rubric as plain text under h1 (e.g. «Караоке-зал», «Гондольная канатная дорога») — no /rubric/ link. */
        try {
          const h1 = card.querySelector('h1') || document.querySelector('h1');
          if (h1) {
            const title = (h1.innerText || '').replace(zw, '').trim();
            const subRoot = h1.parentElement;
            const blockText = (subRoot?.innerText || card.innerText || '').replace(zw, '');
            const lines = blockText
              .split(/\\n/)
              .map((l) => l.replace(zw, '').trim())
              .filter(Boolean);
            let afterTitle = false;
            for (const line of lines) {
              if (line === title) {
                afterTitle = true;
                continue;
              }
              if (!afterTitle) continue;
              if (line.length < 2 || line.length > 120) continue;
              if (/^[1-5][.,]\\d$/.test(line) || /^\\d+[.,]\\d+$/.test(line)) continue;
              if (/отзыв|оценк|reviews?/i.test(line)) continue;
              if (/^\\+?\\d/.test(line)) continue;
              if (/^(закрыто|открыто|круглосуточно)/i.test(line)) continue;
              add(line);
              break;
            }
          }
        } catch (e) {}
        try {
          card.querySelectorAll('a[href*="/rubric/"]').forEach((a) => add(a.textContent));
        } catch (e) {}
        try {
          card.querySelectorAll('a[href]').forEach((a) => {
            const href = (a.getAttribute('href') || '').toLowerCase();
            if (href.includes('rubric')) add(a.textContent);
          });
        } catch (e) {}
        try {
          const h1 = card.querySelector('h1') || document.querySelector('h1');
          const scope = h1 ? h1.closest('article') || h1.parentElement : null;
          if (scope) {
            scope.querySelectorAll('a[href]').forEach((a) => {
              const href = (a.getAttribute('href') || '').toLowerCase();
              const t = (a.textContent || '').replace(/\\s+/g, ' ').trim();
              if (t.length < 2 || t.length > 120) return;
              if (href.includes('rubric')) add(t);
            });
          }
        } catch (e) {}
        try {
          document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
            const raw = s.textContent || '';
            if (!raw) return;
            let j;
            try {
              j = JSON.parse(raw);
            } catch (e) {
              return;
            }
            const arr = Array.isArray(j) ? j : [j];
            for (const o of arr) {
              if (!o || typeof o !== 'object') continue;
              const cat = o.category || o.additionalType;
              if (typeof cat === 'string') add(cat);
              if (Array.isArray(cat)) cat.forEach((c) => (typeof c === 'string' ? add(c) : null));
            }
          });
        } catch (e) {}
        return parts;
      }

      // Coordinates from URL hash (2GIS uses /m=lat,lon format) or og:url meta
      const urlMatch = window.location.href.match(/\\/([0-9]{2}\\.[0-9]+)%2C([0-9]{2}\\.[0-9]+)/)
        || window.location.href.match(/m=([0-9.]+),([0-9.]+)/);
      // Also try og:image which sometimes has a static map with center param
      let lat = urlMatch ? urlMatch[1] : null;
      let lng = urlMatch ? urlMatch[2] : null;
      if (!lat) {
        const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
        const ogMatch = ogImg.match(/center=([0-9.]+)[,%]([0-9.]+)/) || ogImg.match(/([0-9]{2}\\.[0-9]+)[,%]([0-9]{2}\\.[0-9]+)/);
        if (ogMatch) { lat = ogMatch[1]; lng = ogMatch[2]; }
      }

      const h1El = card.querySelector('h1') || document.querySelector('h1');
      const nameFromH1 = (h1El?.textContent || '').replace(/\\s+/g, ' ').trim();
      const name =
        nameFromH1 ||
        getText('[class*="name"]') ||
        getText('[class*="title"]');

      return {
        name: name,
        cardCategories: collectCardCategories(),
        address: getText('address') || getText('[class*="address"]'),
        phones: getLinks('a[href^="tel:"]'),
        emails: getLinks('a[href^="mailto:"]').map(e => e.replace('mailto:', '')),
        website: website,
        instagram: cleanSocial('ig', igLinks),
        whatsapp: cleanSocial('wa', waLinks),
        telegram: cleanSocial('tg', tgLinks),
        facebook: cleanSocial('fb', fbLinks),
        vk: cleanSocial('vk', vkLinks),
        twitter: cleanSocial('tw', twLinks),
        youtube: cleanSocial('yt', ytLinks),
        rating2gis: ratingNum ? String(ratingNum) : null,
        reviewsCount2gis: reviewsNum,
        bin: binMatch ? binMatch[1] : null,
        lat: lat,
        lng: lng,
        bodyText: bodyText.substring(0, 5000)
      };
    })()`);
    
    if (!details?.name) {
      throw new Error('No company name found — page may not have loaded')
    }
    
    const BOT_DETECT_PATTERNS = [
      'вредоносная активность',
      'malicious activity',
      'captcha',
      'доступ ограничен',
      'request-uri too large',
      'bad gateway',
      '502 bad gateway',
    ]
    const textToCheck = `${details.name} ${details.bodyText || ''}`.toLowerCase()
    const nameTrim = (details.name || '').trim()
    const httpErrorTitle = /^(4\d\d|5\d\d)\s+[a-z]/i.test(nameTrim)
    if (httpErrorTitle) {
      throw new AbortError('2GIS/error page title — skip (not a firm)')
    }
    if (BOT_DETECT_PATTERNS.some((p) => textToCheck.includes(p))) {
      const err: any = new AbortError('Anti-bot captcha detected — backing off')
      err.isCaptcha = true
      throw err
    }
    
    // Server-side regex fallback: scan full page text for phones and emails
    const rawText = details.bodyText || ''
    const foundPhones = rawText.match(PHONE_REGEX) || []
    const foundEmails = rawText.match(EMAIL_REGEX) || []
    
    // Merge and deduplicate
    details.phones = [...new Set([...(details.phones || []), ...foundPhones])]
      .filter(isValidContact)
      .map(normalizePhone)
      .filter(Boolean)
    
    details.emails = [...new Set([...(details.emails || []), ...foundEmails])]
      .filter(isValidContact)
      .map(normalizeEmail)
      .filter(Boolean)

    // 2GIS often shows phone as tel: only (no wa.me button) — still useful for WhatsApp deep links
    if (!details.whatsapp && details.phones?.length) {
      const raw = details.phones[0] as string
      const digits = raw.replace(/\D/g, '')
      let d = digits
      if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1)
      if (d.length === 10) d = '7' + d
      if (d.length === 11 && d.startsWith('7')) {
        details.whatsapp = `https://wa.me/${d}`
      }
    }

    // Clean up — don't store the full body text in memory
    delete details.bodyText

    const cats = Array.isArray(details.cardCategories) ? details.cardCategories.filter((x: unknown) => typeof x === 'string') : []
    details.twogisCardCategory = cats.length > 0 ? cats.join(' · ') : null
    delete details.cardCategories

    console.log(
      `  ✓ ${details.name} | Phones: ${details.phones.length} | Emails: ${details.emails.length}` +
        (details.twogisCardCategory ? ` | 2GIS card: ${details.twogisCardCategory.slice(0, 120)}${details.twogisCardCategory.length > 120 ? '…' : ''}` : ''),
    )
    return details
  }, {
    retries: DETAIL_RETRIES,
    minTimeout: DETAIL_MIN_TIMEOUT,
    onFailedAttempt: (err) => {
      console.warn(`  ⚠ Detail page attempt ${err.attemptNumber}/${DETAIL_RETRIES + 1} failed: ${err.message}`)
    },
  }).catch((err: any) => {
    if (err?.isCaptcha) throw err
    console.error(`  ✗ Gave up on ${url}: ${err.message}`)
    return null
  })
}

// ─── Pagination helpers ──────────────────────────────────────────────────────

function pageUrl(baseSearchUrl: string, pageNum: number): string {
  return pageNum === 1 ? baseSearchUrl : `${baseSearchUrl}/page/${pageNum}`
}

/**
 * Collect `/firm/` links from the search page.
 * Avoid `document`-wide query — sidebars / recommendations also contain `/firm/` links (wrong rubric).
 */
async function collectFirmLinksOnPage(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a[href*="/firm/"]')) as HTMLAnchorElement[]
    const filtered = all.filter((a) => {
      if (a.closest('aside')) return false
      if (a.closest('footer')) return false
      if (a.closest('[role="complementary"]')) return false
      return true
    })
    const use = filtered.length > 0 ? filtered : all
    return [...new Set(use.map((x) => x.href))]
  })
}

/** Firm cards on a 2GIS search page: href + visible title for name matching. */
async function collectFirmSearchResults(page: Page): Promise<{ href: string; title: string }[]> {
  return page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/firm/"]')) as HTMLAnchorElement[]
    const seen = new Set<string>()
    const out: { href: string; title: string }[] = []
    for (const a of anchors) {
      const href = a.href
      if (!href || seen.has(href)) continue
      seen.add(href)
      const title = (a.textContent || '').replace(/\s+/g, ' ').trim()
      out.push({ href, title })
    }
    return out
  })
}

function normalizeOrgToken(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\b(тоо|тдо|ооо|ип|ао|пао|llp|llc|ltd|ooo)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreTitleMatch(query: string, title: string): number {
  const q = normalizeOrgToken(query)
  const t = normalizeOrgToken(title)
  if (!q || !t) return 0
  if (t === q) return 1
  if (t.includes(q) && q.length >= 4) return 0.95
  if (q.includes(t) && t.length >= 4) return 0.9
  const qw = new Set(q.split(' ').filter((w) => w.length > 2))
  const tw = t.split(' ').filter((w) => w.length > 2)
  if (qw.size === 0) return 0
  let hit = 0
  for (const w of tw) if (qw.has(w)) hit++
  return (hit / Math.max(qw.size, 1)) * 0.85
}

function pickBestFirmUrl(
  companyName: string,
  candidates: { href: string; title: string }[]
): string | null {
  if (candidates.length === 0) return null
  let best = candidates[0]!
  let bestScore = scoreTitleMatch(companyName, best.title || companyName)
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!
    const s = scoreTitleMatch(companyName, c.title || companyName)
    if (s > bestScore) {
      bestScore = s
      best = c
    }
  }
  if (bestScore >= 0.55) return best.href
  if (candidates.length === 1 && companyName.trim().length >= 3) return candidates[0]!.href
  return null
}

// ─── City/Category Scraping (page-by-page) ──────────────────────────────────

/** Optional caps for smoke tests / demos (omit for full production runs). */
export type TwogisRunLimits = {
  /** Stop after this many list pages that contained ≥1 firm (per city/category slice). */
  maxListPages?: number
  /** Stop after this many firm detail navigations (per slice), including failed extracts. */
  maxFirmDetailAttempts?: number
}

/** Bump `scraper_runs.results_count` by 1 (atomic); safe when multiple slices run in parallel. */
async function bumpScraperRunSavedCount(runId: string): Promise<void> {
  await db
    .update(scraperRuns)
    .set({
      resultsCount: sql`((COALESCE(NULLIF(trim(${scraperRuns.resultsCount}), ''), '0')::bigint) + 1)::text`,
    })
    .where(eq(scraperRuns.id, runId))
}

async function bumpScraperRunSliceStats(
  runId: string,
  sliceStats: TwogisSliceStats,
): Promise<void> {
  const s = normalizeSliceStats(sliceStats)
  await db
    .update(scraperRuns)
    .set({
      detailAttempts: sql`COALESCE(${scraperRuns.detailAttempts}, 0) + ${s.detailAttempts}`,
      totalSkipped: sql`COALESCE(${scraperRuns.totalSkipped}, 0) + ${s.totalSkipped}`,
      listPagesCompleted: sql`COALESCE(${scraperRuns.listPagesCompleted}, 0) + ${s.listPagesCompleted}`,
      emptyPageStreakMax: sql`GREATEST(COALESCE(${scraperRuns.emptyPageStreakMax}, 0), ${s.emptyPageStreakMax})`,
    })
    .where(eq(scraperRuns.id, runId))
}

async function scrapeCityCategory(
  page: Page,
  city: string,
  category: string,
  _listStrategy: TwogisListStrategy = 'hybrid',
  sliceCheckpoint?: { directory: string },
  limits?: TwogisRunLimits,
  scraperRunId?: string | null
) {
  const slug = CITY_SLUGS[city] || city.toLowerCase()
  const baseSearchUrl = `https://2gis.kz/${slug}/search/${encodeURIComponent(category)}`

  const cpPath = sliceCheckpoint?.directory
    ? checkpointFilePath(sliceCheckpoint.directory, city, category, _listStrategy, baseSearchUrl)
    : null

  let startPage = 1
  let startFirmIdx = 0
  let totalProcessed = 0
  let totalSkipped = 0

  if (cpPath) {
    const prev = loadCheckpoint(cpPath)
    if (prev && prev.searchUrl === baseSearchUrl) {
      startPage = Math.max(1, prev.page)
      startFirmIdx = Math.max(0, prev.firmIndexOnPage)
      totalProcessed = prev.totalProcessed || 0
      totalSkipped = prev.totalSkipped || 0
      console.log(
        `  [checkpoint] Resuming ${city} / ${category} at page ${startPage}, firm ${startFirmIdx} (saved ${prev.updatedAt})`
      )
    } else if (prev) {
      console.log(`  [checkpoint] Search URL changed — clearing old checkpoint`)
      clearCheckpoint(cpPath)
    }
  }

  const newLeadIds: string[] = []
  let consecutiveCaptchas = 0
  let emptyPages = 0
  let emptyPageStreakMax = 0
  let listPagesCompleted = 0
  let detailAttempts = 0
  let pendingStats = normalizeSliceStats({})

  /** Batch only duplicate-heavy `totalSkipped` bumps; always flush detail/list/empty-streak updates for responsive UI. */
  const RUN_STATS_SKIP_BATCH = 14

  const flushPendingRunStats = async (force = false) => {
    if (!scraperRunId) return
    const sum =
      pendingStats.detailAttempts +
      pendingStats.totalSkipped +
      pendingStats.listPagesCompleted
    if (!force && sum < 1 && pendingStats.emptyPageStreakMax <= 1) return
    const onlySkips =
      pendingStats.detailAttempts === 0 &&
      pendingStats.listPagesCompleted === 0 &&
      pendingStats.totalSkipped > 0
    if (
      !force &&
      onlySkips &&
      pendingStats.totalSkipped < RUN_STATS_SKIP_BATCH &&
      pendingStats.emptyPageStreakMax <= 1
    ) {
      return
    }
    try {
      await bumpScraperRunSliceStats(scraperRunId, pendingStats)
      pendingStats = normalizeSliceStats({})
    } catch (statsErr) {
      console.warn(
        '[2GIS] scraper_runs live stats bump failed',
        statsErr instanceof Error ? statsErr.message : statsErr,
      )
    }
  }

  try {
    console.log(`\n── ${city} / ${category} ── page-by-page ──`)
    if (limits?.maxListPages != null || limits?.maxFirmDetailAttempts != null) {
      console.log(
        `  [limits] maxListPages=${limits.maxListPages ?? '∞'} maxFirmDetailAttempts=${limits.maxFirmDetailAttempts ?? '∞'}`
      )
    }
    const sessionSeen = new Set<string>()
    /** Positive-only cache: avoids repeat `leadExists` queries for the same org name in one slice. */
    const leadExistsPositiveCache = new Set<string>()
    emptyPages = 0
    emptyPageStreakMax = 0
    listPagesCompleted = 0
    detailAttempts = 0
    let stoppedByLimit = false

    outer: for (let pageNum = startPage; emptyPages < MAX_EMPTY_PAGES; pageNum++) {
      const url = pageUrl(baseSearchUrl, pageNum)
      console.log(`  📄 Page ${pageNum}: ${url}`)

      const listPhase = await runSearchListPhase(page, url, _listStrategy, collectFirmLinksOnPage, {
        initialWaitMs: 1800 + Math.floor(Math.random() * 1200),
        maxScrolls: 8,
        scrollWaitMs: 450 + Math.floor(Math.random() * 250),
      })
      console.log(`    ${formatListMetricsLog(city, category, listPhase.metrics)}`)
      const firms = listPhase.links
      if (firms.length === 0) {
        emptyPages++
        emptyPageStreakMax = Math.max(emptyPageStreakMax, emptyPages)
        pendingStats.emptyPageStreakMax = Math.max(
          pendingStats.emptyPageStreakMax,
          emptyPages,
        )
        await flushPendingRunStats(true)
        console.log(`    No firms on page ${pageNum} (empty streak: ${emptyPages}/${MAX_EMPTY_PAGES})`)
        continue
      }
      emptyPages = 0
      console.log(`    ${firms.length} firms on page ${pageNum}`)

      const firmStart = pageNum === startPage ? startFirmIdx : 0

      if (firms.length > 0) {
        await page.waitForTimeout(400 + Math.random() * 600)
      }

      const urlsAlreadyInDb = await loadExistingSourceUrlsSet(firms)

      for (let fi = firmStart; fi < firms.length; fi++) {
        const link = firms[fi]
        const linkKey = normalizeFirmUrl(link)

        if (urlsAlreadyInDb.has(linkKey)) {
          totalSkipped++
          pendingStats.totalSkipped++
          await flushPendingRunStats()
          if (cpPath)
            saveCheckpoint(cpPath, buildCheckpoint(city, category, _listStrategy, baseSearchUrl, pageNum, fi + 1, totalProcessed, totalSkipped))
          continue
        }

        if (
          limits?.maxFirmDetailAttempts != null &&
          detailAttempts >= limits.maxFirmDetailAttempts
        ) {
          console.log(`  [limits] Reached maxFirmDetailAttempts=${limits.maxFirmDetailAttempts} — stopping slice`)
          stoppedByLimit = true
          break outer
        }

        if (fi > 0 || pageNum > startPage) {
          await page.waitForTimeout(700 + Math.random() * 1100)
        }

        detailAttempts++
        pendingStats.detailAttempts++
        await flushPendingRunStats()
        let details: any
        try {
          details = await scrapeCompanyDetail(page, link)
        } catch (detailErr: any) {
          if (detailErr?.isCaptcha) {
            consecutiveCaptchas++
            const backoff = CAPTCHA_BACKOFF_MIN_MS + Math.random() * (CAPTCHA_BACKOFF_MAX_MS - CAPTCHA_BACKOFF_MIN_MS)
            console.warn(`  🛑 Captcha detected (${consecutiveCaptchas}/${MAX_CONSECUTIVE_CAPTCHAS}) — backing off ${Math.round(backoff / 1000)}s`)
            if (consecutiveCaptchas >= MAX_CONSECUTIVE_CAPTCHAS) {
              console.error(`  ✗ ${MAX_CONSECUTIVE_CAPTCHAS} consecutive captchas — aborting ${city} / ${category}`)
              if (cpPath)
                saveCheckpoint(cpPath, buildCheckpoint(city, category, _listStrategy, baseSearchUrl, pageNum, fi, totalProcessed, totalSkipped))
              await flushPendingRunStats(true)
              return {
                processed: totalProcessed,
                leadIds: newLeadIds,
              }
            }
            await page.waitForTimeout(backoff)
            if (cpPath)
              saveCheckpoint(cpPath, buildCheckpoint(city, category, _listStrategy, baseSearchUrl, pageNum, fi + 1, totalProcessed, totalSkipped))
            continue
          }
          details = null
        }
        consecutiveCaptchas = 0

        if (!details?.name) {
          if (cpPath)
            saveCheckpoint(cpPath, buildCheckpoint(city, category, _listStrategy, baseSearchUrl, pageNum, fi + 1, totalProcessed, totalSkipped))
          continue
        }

        const normalizedName = details.name.trim()
        const sessionKey = `${normalizedName.toLowerCase()}|${city.toLowerCase()}`

        if (sessionSeen.has(sessionKey)) {
          totalSkipped++
          pendingStats.totalSkipped++
          await flushPendingRunStats()
          if (cpPath)
            saveCheckpoint(cpPath, buildCheckpoint(city, category, _listStrategy, baseSearchUrl, pageNum, fi + 1, totalProcessed, totalSkipped))
          continue
        }
        if (leadExistsPositiveCache.has(sessionKey)) {
          totalSkipped++
          pendingStats.totalSkipped++
          await flushPendingRunStats()
          console.log(`  ↩ Skipped (exists): ${normalizedName}`)
          sessionSeen.add(sessionKey)
          if (cpPath)
            saveCheckpoint(cpPath, buildCheckpoint(city, category, _listStrategy, baseSearchUrl, pageNum, fi + 1, totalProcessed, totalSkipped))
          continue
        }
        if (await leadExists(normalizedName, city)) {
          leadExistsPositiveCache.add(sessionKey)
          totalSkipped++
          pendingStats.totalSkipped++
          await flushPendingRunStats()
          console.log(`  ↩ Skipped (exists): ${normalizedName}`)
          sessionSeen.add(sessionKey)
          if (cpPath)
            saveCheckpoint(cpPath, buildCheckpoint(city, category, _listStrategy, baseSearchUrl, pageNum, fi + 1, totalProcessed, totalSkipped))
          continue
        }
        sessionSeen.add(sessionKey)

        try {
          const leadId = deterministicId(normalizedName, city)

          const primaryEmail = details.emails?.[0] || null

          const runTag =
            scraperRunId != null && scraperRunId.length > 0
              ? { rawData: sql`COALESCE(${leads.rawData}, '{}'::jsonb) || jsonb_build_object('twogisScraperRunId', ${scraperRunId}::text)` }
              : {}

          const [lead] = await db
            .insert(leads)
            .values({
              id: leadId,
              name: normalizedName,
              bin: details.bin || null,
              city,
              address: details.address,
              website: details.website,
              email: primaryEmail,
              category,
              source: '2gis',
              sourceUrl: link,
              whatsapp: details.whatsapp,
              instagram: details.instagram,
              telegram: details.telegram,
              facebook: details.facebook,
              vk: details.vk,
              twitter: details.twitter,
              youtube: details.youtube,
              rating2gis: details.rating2gis,
              reviewsCount2gis: details.reviewsCount2gis,
              openingHours: details.openingHours ? { raw: details.openingHours } : null,
              lat: details.lat,
              lng: details.lng,
              discoveryLevel: 1,
              status: 'valid',
              twogisCardCategory: details.twogisCardCategory ?? null,
              ...(scraperRunId ? { rawData: { twogisScraperRunId: scraperRunId } } : {}),
            })
            .onConflictDoUpdate({
              target: leads.id,
              set: {
                updatedAt: new Date(),
                bin: details.bin || null,
                address: details.address,
                website: details.website,
                email: primaryEmail,
                whatsapp: details.whatsapp,
                instagram: details.instagram,
                telegram: details.telegram,
                facebook: details.facebook,
                vk: details.vk,
                twitter: details.twitter,
                youtube: details.youtube,
                rating2gis: details.rating2gis,
                reviewsCount2gis: details.reviewsCount2gis,
                openingHours: details.openingHours ? { raw: details.openingHours } : null,
                lat: details.lat,
                lng: details.lng,
                sourceUrl: link,
                twogisCardCategory: details.twogisCardCategory ?? null,
                ...runTag,
              },
            })
            .returning()

          if (details.phones?.length) {
            for (const phone of details.phones) {
              await db
                .insert(contacts)
                .values({ leadId: lead.id, phone, source: '2gis', sourceUrl: link })
                .onConflictDoNothing()
            }
          }

          if (details.emails?.length) {
            for (const email of details.emails) {
              await db
                .insert(contacts)
                .values({ leadId: lead.id, email, source: '2gis', sourceUrl: link })
                .onConflictDoNothing()
            }
          }

          totalProcessed++
          newLeadIds.push(lead.id)
          urlsAlreadyInDb.add(linkKey)
          leadExistsPositiveCache.add(sessionKey)
          if (scraperRunId) {
            try {
              await bumpScraperRunSavedCount(scraperRunId)
            } catch (bumpErr) {
              console.warn(
                '[2GIS] scraper_runs.results_count bump failed (banner may lag); lead still saved:',
                bumpErr instanceof Error ? bumpErr.message : bumpErr
              )
            }
          }
        } catch (dbErr: any) {
          console.error(`  ✗ DB error saving ${normalizedName}: ${dbErr.message}`)
        }

        if (cpPath) {
          saveCheckpoint(cpPath, buildCheckpoint(city, category, _listStrategy, baseSearchUrl, pageNum, fi + 1, totalProcessed, totalSkipped))
        }
      }

      // Finished all firms on this page — advance checkpoint to next page, firm 0
      if (cpPath) {
        saveCheckpoint(cpPath, buildCheckpoint(city, category, _listStrategy, baseSearchUrl, pageNum + 1, 0, totalProcessed, totalSkipped))
      }

      listPagesCompleted++
      pendingStats.listPagesCompleted++
      await flushPendingRunStats(true)
      if (limits?.maxListPages != null && listPagesCompleted >= limits.maxListPages) {
        console.log(`  [limits] Reached maxListPages=${limits.maxListPages} — stopping slice`)
        stoppedByLimit = true
        break outer
      }

      await page.waitForTimeout(600 + Math.random() * 900)
    }

    if (cpPath && !stoppedByLimit) {
      clearCheckpoint(cpPath)
      console.log(`  [checkpoint] Slice complete — cleared checkpoint for ${city} / ${category}`)
    }

    await flushPendingRunStats(true)
    console.log(`  ── Results: ${totalProcessed} saved, ${totalSkipped} duplicates skipped ──`)
    return {
      processed: totalProcessed,
      leadIds: newLeadIds,
    }
  } catch (err: any) {
    console.error(`Error scraping ${city}/${category}:`, err.message)
    if (sliceCheckpoint?.directory) {
      console.error(
        `  [checkpoint] Progress saved — re-run to resume from page ${startPage} firm ${startFirmIdx}`
      )
    }
    await flushPendingRunStats(true)
    return {
      processed: totalProcessed,
      leadIds: newLeadIds,
    }
  }
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export type { TwogisListStrategy } from './twogis-list-collector.js'

export type TwogisStartRequest = {
  url: string
  uniqueKey: string
  userData: {
    city: string
    category: string
    listStrategy: TwogisListStrategy
    limits?: TwogisRunLimits
  }
}

/** Pure helper for tests + debugging: expands city×category into Crawlee start requests. */
export function buildTwogisStartRequests(args: {
  cities: string[]
  categories: string[]
  listStrategy: TwogisListStrategy
  limits?: TwogisRunLimits
}): TwogisStartRequest[] {
  const { cities, categories, listStrategy, limits } = args
  return cities.flatMap((city) => {
    const slug = CITY_SLUGS[city] || city.toLowerCase()
    return categories.map((category) => ({
      url: `https://2gis.kz/${slug}/search/${encodeURIComponent(category)}`,
      uniqueKey: `2gis|${city}|${category}`,
      userData: { city, category, listStrategy, limits },
    }))
  })
}

export async function run2GisScraper(options?: {
  cities?: string[]
  categories?: string[]
  headless?: boolean
  listStrategy?: TwogisListStrategy
  /** Number of browser instances to run in parallel. Defaults to 3 with proxy, 1 without. */
  maxConcurrency?: number
  /** When true, ignore SMARTPROXY_* (faster local smoke tests; use proxy in production). */
  skipProxy?: boolean
  /**
   * Persist per-city/category progress (page number + firm index).
   * On crash, re-run the same cities/categories to resume exactly where it left off.
   */
  resumeCheckpoint?: boolean
  /** Override checkpoint directory (default: `.twogis-checkpoints` in cwd or `TWOGIS_CHECKPOINT_DIR`). */
  checkpointDirectory?: string
  /** Cap work per slice (for smoke tests). Omit for full runs. */
  limits?: TwogisRunLimits
  /**
   * When the API (or another orchestrator) already inserted `scraper_runs`, pass its id here
   * so we do not create a duplicate row and progress maps to the UI-tracked run.
   */
  scraperRunId?: string
}) {
  const citiesToScrape = options?.cities || CITIES
  const categoriesToScrape = options?.categories || [...TWOGIS_DEFAULT_CATEGORIES]
  const headless = options?.headless ?? true
  const listStrategy = options?.listStrategy ?? 'hybrid'
  const sliceCheckpoint =
    options?.resumeCheckpoint === true
      ? { directory: options.checkpointDirectory?.trim() || defaultCheckpointDirectory() }
      : undefined

  const proxyUrl = options?.skipProxy ? null : buildProxyUrl()
  const concurrency = options?.maxConcurrency ?? (proxyUrl ? 3 : 1)

  console.log('═══════════════════════════════════════════════')
  console.log(`Starting 2GIS Scraper (page-by-page pagination)`)
  console.log(`Cities: ${citiesToScrape.length} | Categories: ${categoriesToScrape.length} | Concurrency: ${concurrency}`)
  console.log(`Total slices: ${citiesToScrape.length * categoriesToScrape.length}`)
  if (options?.skipProxy) console.log(`Proxy: OFF (skipProxy — direct connection)`)
  else if (proxyUrl) console.log(`Proxy: SmartProxy residential (each browser gets fresh IP)`)
  else console.log(`Proxy: none (set SMARTPROXY_USER/PASS for residential)`)
  if (sliceCheckpoint) {
    console.log(`Resume checkpoints: ON → ${sliceCheckpoint.directory} (process.cwd=${process.cwd()})`)
  } else {
    console.log(`Resume checkpoints: OFF (same as most CLI scripts — no stale .twogis-checkpoints resume)`)
  }
  if (options?.limits) console.log(`Run limits: ${JSON.stringify(options.limits)}`)
  console.log('═══════════════════════════════════════════════')

  let runId: string | null = options?.scraperRunId?.trim() || null
  if (!runId) {
    try {
      const [row] = await db
        .insert(scraperRuns)
        .values({ scraper: '2gis', status: 'running' })
        .returning({ id: scraperRuns.id })
      runId = row.id
    } catch (err) {
      console.warn('[2GIS] Could not insert scraper_runs row:', err instanceof Error ? err.message : err)
    }
  }

  let grandTotal = 0
  const allNewLeadIds: string[] = []

  const startRequests = buildTwogisStartRequests({
    cities: citiesToScrape,
    categories: categoriesToScrape,
    listStrategy,
    limits: options?.limits,
  })

  const crawleeConfig = new Configuration({ purgeOnStart: true })

  try {
    const crawler = new PlaywrightCrawler(
      {
        maxConcurrency: concurrency,
        maxRequestRetries: 3,
        headless,
        requestHandlerTimeoutSecs: 4 * 60 * 60,
        /** 2GIS + residential proxy: `load` often never fires in time; `domcontentloaded` matches our list-phase goto. */
        navigationTimeoutSecs: 240,
        launchContext: {
          launcher: chromium as any,
          launchOptions: {
            headless,
            args: [
              '--disable-blink-features=AutomationControlled',
              '--disable-dev-shm-usage',
              '--no-sandbox',
            ],
            ...(proxyUrl && {
              proxy: {
                server: proxyUrl,
              },
            }),
          },
        },
        preNavigationHooks: [
          async (crawlingCtx, gotoOptions) => {
            const { page, request } = crawlingCtx as { page: Page; request: { url: string } }
            const logNav = !headless || env.TWOGIS_LOG_NAVIGATION === '1'
            if (logNav && request?.url) {
              console.log(`[2GIS] nav ${request.url}`)
            }
            await blockHeavyResourcesOnPage(page)
            /** `commit` = response received; `domcontentloaded` often never fires on 2GIS+proxy before timeout. */
            gotoOptions.waitUntil = 'commit'
            await page.context().setExtraHTTPHeaders({
              ...CLIENT_HINT_HEADERS,
            })
            const browserCtx = page.context()
            await browserCtx.addInitScript(() => {
              Object.defineProperty(navigator, 'webdriver', { get: () => false })
            })
          },
        ],
        browserPoolOptions: {
          preLaunchHooks: [
            async (_pageId, launchContext) => {
              (launchContext as any).launchOptions ??= {};
              (launchContext as any).launchOptions.viewport = VIEWPORT;
              (launchContext as any).launchOptions.userAgent = REALISTIC_UA
            },
          ],
        },
        async requestHandler({ page, request, crawler }) {
          if (runId) {
            const [runRow] = await db
              .select({ status: scraperRuns.status })
              .from(scraperRuns)
              .where(eq(scraperRuns.id, runId))
              .limit(1)
            const st = (runRow?.status ?? '').toLowerCase()
            if (st === 'cancelled') {
              crawler.stop('Cancelled via dashboard — draining queue after this slice')
              return
            }
          }

          const { city, category, listStrategy: strategy, limits } = request.userData as {
            city: string
            category: string
            listStrategy: TwogisListStrategy
            limits?: TwogisRunLimits
          }
          const result = await scrapeCityCategory(page, city, category, strategy, sliceCheckpoint, limits, runId)
          grandTotal += result.processed
          allNewLeadIds.push(...result.leadIds)
          await page.waitForTimeout(400 + Math.random() * 600)
        },
        failedRequestHandler: async ({ request }) => {
          console.error(
            `[2GIS] Crawlee gave up on ${request.url}:`,
            request.errorMessages.join('; ')
          )
        },
      },
      crawleeConfig
    )

    const crawlStats = await crawler.run(startRequests)
    const requestsFinished = Number(crawlStats.requestsFinished ?? 0)
    const requestsFailed = Number(crawlStats.requestsFailed ?? 0)

    if (runId) {
      const [finalRow] = await db
        .select({ status: scraperRuns.status })
        .from(scraperRuns)
        .where(eq(scraperRuns.id, runId))
        .limit(1)
      const fst = (finalRow?.status ?? '').toLowerCase()
      if (fst === 'cancelled') {
        return { total: grandTotal, runId, leadIds: allNewLeadIds }
      }

      const totalTried = requestsFinished + requestsFailed
      const allSlicesDead =
        totalTried > 0 && requestsFinished === 0 && requestsFailed > 0 && grandTotal === 0

      await db
        .update(scraperRuns)
        .set({
          status: allSlicesDead ? 'error' : 'done',
          completedAt: new Date(),
          ...(allSlicesDead
            ? {
                resultsCount: '0',
                error:
                  'Every 2GIS slice failed in Crawlee before any lead was saved (usually navigation timeout, proxy, or 2GIS blocking). Check API logs and try skipProxy locally or fix SMARTPROXY_*.',
              }
            : {
                error: null,
                /** Never downgrade an incrementally-updated counter; reconcile with in-memory total. */
                resultsCount: sql`GREATEST(
                  COALESCE(NULLIF(trim(${scraperRuns.resultsCount}), ''), '0')::bigint,
                  ${grandTotal}::bigint
                )::text`,
              }),
        })
        .where(eq(scraperRuns.id, runId))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (runId) {
      const [cur] = await db
        .select({ status: scraperRuns.status })
        .from(scraperRuns)
        .where(eq(scraperRuns.id, runId))
        .limit(1)
      if ((cur?.status ?? '').toLowerCase() !== 'cancelled') {
        await db
          .update(scraperRuns)
          .set({
            status: 'error',
            error: message,
            completedAt: new Date(),
          })
          .where(eq(scraperRuns.id, runId))
          .catch(() => {})
      }
    }
    throw err
  } finally {
    console.log(`\n═══════════════════════════════════════════════`)
    console.log(`2GIS Scraper complete: ${grandTotal} leads saved, ${allNewLeadIds.length} new lead IDs`)
    console.log('═══════════════════════════════════════════════')
  }

  return { total: grandTotal, runId, leadIds: allNewLeadIds }
}

/**
 * For leads discovered outside 2GIS: search 2GIS.kz by company name (+ city slug), pick the best
 * card match on page 1, scrape the firm page, and merge phones, rating, coordinates, etc.
 * Skips leads that already come from 2GIS or have a successful `twogisSearch` enrichment (unless `force`).
 */
export async function enrichLeadFromTwogisSearch(
  leadId: string,
  options?: { force?: boolean; headless?: boolean; skipProxy?: boolean }
): Promise<{ success: boolean; error?: string; firmUrl?: string; skipped?: boolean }> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1)
  if (!lead) return { success: false, error: 'Lead not found' }

  const sources = (lead.enrichmentSources ?? {}) as Record<string, unknown>
  const twPrev = sources.twogisSearch as { status?: string } | undefined

  if (!options?.force) {
    if (lead.source === '2gis' || lead.source === '2gis-extension') {
      return { success: true, skipped: true }
    }
    if (twPrev?.status === 'ok') {
      return { success: true, skipped: true }
    }
  }

  const name = lead.name?.trim()
  if (!name) return { success: false, error: 'Lead has no company name for 2GIS search' }

  const city = lead.city?.trim() || 'Алматы'
  const slug =
    CITY_SLUGS[city] ?? (/^[a-z0-9-]+$/i.test(city) ? city.toLowerCase() : 'almaty')

  const mergeTwogisSource = async (twogisSearch: Record<string, unknown>) => {
    const [row] = await db
      .select({ enrichmentSources: leads.enrichmentSources })
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1)
    const prev = (row?.enrichmentSources ?? {}) as Record<string, unknown>
    await db
      .update(leads)
      .set({
        enrichmentSources: { ...prev, twogisSearch },
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId))
  }

  const searchUrl = `https://2gis.kz/${slug}/search/${encodeURIComponent(name)}`
  console.log(`[2GIS enrich] ${leadId} → ${searchUrl}`)

  const proxyUrl = options?.skipProxy ? null : buildProxyUrl()
  const headless = options?.headless ?? true

  const browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox'],
    ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
  })

  try {
    const context = await browser.newContext({
      userAgent: REALISTIC_UA,
      viewport: VIEWPORT,
      extraHTTPHeaders: CLIENT_HINT_HEADERS,
    })
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })
    const page = await context.newPage()

    await runSearchListPhase(page, searchUrl, 'hybrid', collectFirmLinksOnPage, {
      initialWaitMs: 1800 + Math.floor(Math.random() * 1200),
      maxScrolls: 8,
      scrollWaitMs: 450 + Math.floor(Math.random() * 250),
    })
    const candidates = await collectFirmSearchResults(page)
    const firmUrl = pickBestFirmUrl(name, candidates)
    if (!firmUrl) {
      await mergeTwogisSource({
        at: new Date().toISOString(),
        status: 'not_found',
        query: name,
        city,
      })
      return { success: false, error: 'No matching firm on first 2GIS search page' }
    }

    let details: any
    try {
      details = await scrapeCompanyDetail(page, firmUrl)
    } catch (e: any) {
      if (e?.isCaptcha) {
        await mergeTwogisSource({
          at: new Date().toISOString(),
          status: 'error',
          error: 'captcha',
          firmUrl,
        })
        throw e
      }
      details = null
    }

    if (!details?.name) {
      await mergeTwogisSource({
        at: new Date().toISOString(),
        status: 'error',
        error: 'detail_parse_failed',
        firmUrl,
      })
      return { success: false, error: 'Could not parse 2GIS firm page' }
    }

    const prevRaw =
      lead.rawData && typeof lead.rawData === 'object' && !Array.isArray(lead.rawData)
        ? { ...(lead.rawData as Record<string, unknown>) }
        : {}

    const [fresh] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1)
    const freshSources = (fresh?.enrichmentSources ?? sources) as Record<string, unknown>

    const enrichPrimaryEmail = details.emails?.[0] || null

    await db
      .update(leads)
      .set({
        bin: fresh?.bin?.trim() ? fresh.bin : details.bin || null,
        address: fresh?.address?.trim() ? fresh.address : details.address || null,
        website: fresh?.website?.trim() ? fresh.website : details.website || null,
        email: fresh?.email?.trim() ? fresh.email : enrichPrimaryEmail,
        whatsapp: fresh?.whatsapp || details.whatsapp || null,
        instagram: fresh?.instagram || details.instagram || null,
        telegram: fresh?.telegram || details.telegram || null,
        facebook: fresh?.facebook || details.facebook || null,
        vk: fresh?.vk || details.vk || null,
        twitter: fresh?.twitter || details.twitter || null,
        youtube: fresh?.youtube || details.youtube || null,
        rating2gis: details.rating2gis || fresh?.rating2gis || null,
        reviewsCount2gis: Math.max(fresh?.reviewsCount2gis ?? 0, details.reviewsCount2gis ?? 0),
        lat: fresh?.lat?.trim() ? fresh.lat : details.lat || null,
        lng: fresh?.lng?.trim() ? fresh.lng : details.lng || null,
        sourceUrl: fresh?.sourceUrl?.trim() ? fresh.sourceUrl : firmUrl,
        twogisCardCategory: details.twogisCardCategory ?? fresh?.twogisCardCategory ?? null,
        rawData: { ...prevRaw, twogisFirmUrl: firmUrl },
        enrichmentSources: {
          ...freshSources,
          twogisSearch: {
            at: new Date().toISOString(),
            status: 'ok',
            firmUrl,
            matchedTitle: details.name,
          },
        },
        lastEnrichedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId))

    if (details.phones?.length) {
      for (const phone of details.phones) {
        await db
          .insert(contacts)
          .values({ leadId, phone, source: '2gis_search', sourceUrl: firmUrl })
          .onConflictDoNothing()
      }
    }
    if (details.emails?.length) {
      for (const email of details.emails) {
        await db
          .insert(contacts)
          .values({ leadId, email, source: '2gis_search', sourceUrl: firmUrl })
          .onConflictDoNothing()
      }
    }

    console.log(`[2GIS enrich] ✓ ${leadId} → ${firmUrl}`)
    return { success: true, firmUrl }
  } finally {
    await browser.close().catch(() => {})
  }
}

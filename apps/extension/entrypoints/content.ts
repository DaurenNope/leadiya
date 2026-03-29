import { defineContentScript } from 'wxt/utils/define-content-script'
import { mountLeadiyaDock } from '../lib/2gis-dock'
import { collectPhones, isPhoneRevealLabel } from '../lib/phones'

export interface LeadData {
  name: string
  address: string
  phones: string[]
  emails: string[]
  website: string
  instagram: string
  whatsapp: string
  telegram: string
  facebook: string
  rating: number | null
  bin: string
  lat: string
  lng: string
  sourceUrl: string
  city?: string
  category?: string
}

function getText(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() || ''
}

function getLinks(selector: string): string[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>(selector))
    .map((el) => el.href || el.textContent?.trim() || '')
    .filter(Boolean)
}

function decode2GisLink(link: string): string {
  if (!link) return ''
  if (!link.includes('link.2gis.com') && !link.includes('link.2gis.ru')) return link
  try {
    const url = new URL(link)
    const pathParts = url.pathname.split('/')
    const b64 = pathParts[pathParts.length - 1]
    if (!b64) return link
    let raw = ''
    try {
      raw = decodeURIComponent(escape(atob(b64)))
    } catch {
      raw = atob(b64)
    }
    const lines = raw.split('\n').filter((l) => l.startsWith('http'))
    return lines[0] || link
  } catch {
    return link
  }
}

function inferCityFromUrl(urlRaw: string): string {
  try {
    const url = new URL(urlRaw)
    const parts = url.pathname.split('/').filter(Boolean)
    return decodeURIComponent(parts[0] || '').trim()
  } catch {
    return ''
  }
}

function inferCategoryFromUrl(urlRaw: string): string {
  try {
    const url = new URL(urlRaw)
    const parts = url.pathname.split('/').filter(Boolean)
    const searchIdx = parts.findIndex((p) => p === 'search')
    if (searchIdx >= 0 && parts[searchIdx + 1]) {
      return decodeURIComponent(parts[searchIdx + 1]).trim().replace(/\+/g, ' ')
    }
    return ''
  } catch {
    return ''
  }
}

function inferCategoryFromDom(): string {
  // On firm cards 2GIS exposes category mostly via rubric chips/links.
  const rubricAnchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/rubric/"]')
  )
  const searchAnchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/search/"]')
  )
  const rubricNodes = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-testid*="rubric"], [class*="rubric"], [class*="Rubric"], [class*="category"], [aria-label*="Рубрик"], [aria-label*="Категор"]'
    )
  )
  const badWords = new Set([
    'android', 'ios', 'google play', 'app store', 'instagram', 'whatsapp', 'telegram',
    'facebook', 'войти', 'отзывы', 'фото', 'маршрут', 'сайт', 'позвонить', 'поделиться',
  ])
  const normalizeCandidate = (raw: string) =>
    raw
      .replace(/\s+/g, ' ')
      .replace(/[•|/]+/g, ' ')
      .trim()
  const isValid = (v: string) => {
    const low = v.toLowerCase()
    if (v.length < 2 || v.length > 56) return false
    if (!/[a-zа-яё]/i.test(v)) return false
    if (/^[0-9.,\s]+$/.test(v)) return false
    if (/^https?:\/\//i.test(v)) return false
    if (badWords.has(low)) return false
    return true
  }

  type Candidate = { text: string; weight: number }
  const candidates: Candidate[] = []

  for (const a of rubricAnchors) {
    const text = normalizeCandidate(a.textContent || '')
    if (isValid(text)) candidates.push({ text, weight: 100 })
  }
  for (const n of rubricNodes) {
    const text = normalizeCandidate(n.textContent || '')
    if (isValid(text)) candidates.push({ text, weight: 80 })
  }
  for (const a of searchAnchors) {
    const text = normalizeCandidate(a.textContent || '')
    if (isValid(text)) candidates.push({ text, weight: 60 })
  }

  if (!candidates.length) return ''
  const score = (c: Candidate) => {
    let s = c.weight
    // Penalize marketing-like long phrases and noisy punctuation.
    const words = c.text.split(' ').filter(Boolean).length
    if (words > 4) s -= 25
    if (/[,:;()[\]{}]/.test(c.text)) s -= 10
    if (/\d/.test(c.text)) s -= 10
    return s
  }
  candidates.sort((a, b) => score(b) - score(a) || a.text.length - b.text.length)
  return candidates[0]?.text || ''
}

function inferCategoryFromJsonLd(): string {
  try {
    const scripts = Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')
    )
    for (const s of scripts) {
      const raw = (s.textContent || '').trim()
      if (!raw) continue
      let parsed: any
      try {
        parsed = JSON.parse(raw)
      } catch {
        continue
      }
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of items) {
        const category = item?.category
        if (typeof category === 'string' && category.trim()) {
          const v = category.trim()
          if (!/^(organization|localbusiness|business)$/i.test(v)) return v
        }
        if (Array.isArray(category)) {
          const first = category.find((x) => typeof x === 'string' && x.trim())
          if (typeof first === 'string') {
            const v = first.trim()
            if (!/^(organization|localbusiness|business)$/i.test(v)) return v
          }
        }
      }
    }
    return ''
  } catch {
    return ''
  }
}

function extractFirmData(): LeadData {
  const name = getText('h1')

  const address = getText('address') || getText('[class*="address"]')

  const telLinks = getLinks('a[href^="tel:"]')

  const emails = getLinks('a[href^="mailto:"]').map((e) => e.replace('mailto:', ''))

  const website = extractWebsiteFromDom()

  const igLinks = getLinks('a[href*="instagram.com"]')
  const waLinks = getLinks('a[href*="wa.me"], a[href*="whatsapp.com"]')
  const tgLinks = getLinks('a[href*="t.me"]')
  const fbLinks = getLinks('a[href*="facebook.com"]')

  let ratingNum: number | null = null
  const spans = document.querySelectorAll('div, span')
  for (const el of spans) {
    const t = el.textContent?.trim() || ''
    if (/^[1-5]\.[0-9]$/.test(t)) {
      ratingNum = parseFloat(t)
      break
    }
  }

  const bodyText = document.body?.innerText || ''
  const phones = collectPhones(telLinks, bodyText)
  const binMatch = bodyText.match(/(?:БИН|BIN|ИИН|IIN)[:\s]*([0-9]{12})/)
  const bin = binMatch?.[1] || ''

  let lat = ''
  let lng = ''
  try {
    const urlMatch = window.location.href.match(/\/(\d+\.\d+)%2C(\d+\.\d+)/)
    if (urlMatch) {
      lng = urlMatch[1]
      lat = urlMatch[2]
    }
  } catch {}

  const city = inferCityFromUrl(window.location.href)
  const categoryFromUrl = inferCategoryFromUrl(window.location.href)
  const categoryFromJsonLd = inferCategoryFromJsonLd()
  const category = categoryFromUrl || categoryFromJsonLd || inferCategoryFromDom()

  return {
    name,
    address,
    phones,
    emails,
    website,
    instagram: igLinks[0] || '',
    whatsapp: waLinks[0] || '',
    telegram: tgLinks[0] || '',
    facebook: fbLinks[0] || '',
    rating: ratingNum,
    bin,
    lat,
    lng,
    sourceUrl: window.location.href,
    city: city || undefined,
    category: category || undefined,
  }
}

function revealPhoneButtons(): number {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="button"], a, span, div, [aria-label], [data-testid]'),
  ).filter((el) => {
    const text = [el.innerText || '', el.textContent || '', el.getAttribute('aria-label') || ''].join(' ').trim()
    if (isPhoneRevealLabel(text)) return true
    // 2GIS often uses generic "Показать" buttons for hidden phone chunks.
    return /(показать|show)/i.test(text) && /(тел|номер|phone|contact|контакт)/i.test(text)
  })

  const isVisible = (el: HTMLElement) => {
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    if (el.getAttribute('aria-disabled') === 'true') return false
    return true
  }

  let clicked = 0
  for (const el of candidates) {
    if (!isVisible(el)) continue
    const clickTarget = (el.closest('button, [role="button"], a') as HTMLElement | null) ?? el
    if (!isVisible(clickTarget)) continue
    try {
      clickTarget.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
      clickTarget.click()
      clicked += 1
    } catch {
      // ignore and try next candidate
    }
  }

  return clicked
}

async function extractFirmDataWithPhoneReveal(): Promise<LeadData> {
  let best = extractFirmData()
  if (best.phones.length >= 2) return best

  for (let round = 0; round < 4; round++) {
    const clicked = revealPhoneButtons()
    if (clicked <= 0 && round > 0) break
    await sleep(500)
    const cur = extractFirmData()
    if (cur.phones.length > best.phones.length) best = cur
    if (best.phones.length >= 2) return best
  }

  return best
}

function extractWebsiteFromDom(): string {
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
  const byText = anchors.find((a) => /наш\s*сайт|сайт|website/i.test((a.textContent || '').trim()))
  const candidates = [
    byText?.href || '',
    ...anchors
      .map((a) => a.href || '')
      .filter((href) =>
        /link\.2gis\.(com|ru)/i.test(href) ||
        /^https?:\/\//i.test(href)
      ),
  ]
  const bad = /(instagram\.com|wa\.me|whatsapp\.com|t\.me|facebook\.com|vk\.com|2gis\.)/i
  for (const raw of candidates) {
    const decoded = decode2GisLink(raw)
    if (!decoded || bad.test(decoded)) continue
    if (!/^https?:\/\//i.test(decoded)) continue
    return decoded
  }
  return ''
}

function collectFirmLinks(): string[] {
  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href*="/firm/"], a[href*="/geo/"]')
  const seen = new Set<string>()
  const links: string[] = []
  for (const a of anchors) {
    const href = a.href.split('?')[0]
    if (!/\/(firm|geo)\//.test(href)) continue
    if (!seen.has(href)) {
      seen.add(href)
      links.push(href)
    }
  }
  return links
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function getScrollableContainers(): HTMLElement[] {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('div, main, section, aside'))
  const ranked = nodes
    .filter((el) => {
      const style = window.getComputedStyle(el)
      const canScrollY = style.overflowY === 'auto' || style.overflowY === 'scroll'
      return canScrollY && el.scrollHeight - el.clientHeight > 220
    })
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
  return ranked.slice(0, 4)
}

async function scrollResultsArea(): Promise<void> {
  const containers = getScrollableContainers()
  if (containers.length === 0) {
    window.scrollBy({ top: Math.max(700, window.innerHeight), behavior: 'instant' as ScrollBehavior })
    await sleep(280)
    return
  }
  for (const el of containers) {
    el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + Math.max(550, el.clientHeight * 0.9))
  }
  await sleep(320)
}

function extractNextSearchUrl(): string | null {
  const current = window.location.href
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
  const candidates = links
    .map((a) => a.href)
    .filter((href) => href && href !== current)
    .filter((href) => /\/search\//.test(href))
    .filter((href) => /([?&]page=\d+|\/page\/\d+)/.test(href))
  if (candidates.length === 0) return null
  return candidates[0] || null
}

async function collectFirmLinksPaginated(_maxPages = 1): Promise<string[]> {
  const seen = new Set<string>()
  const debug: string[] = []
  let stableRounds = 0
  for (let round = 0; round < 14; round++) {
    const before = seen.size
    for (const link of collectFirmLinks()) seen.add(link)
    const after = seen.size
    await scrollResultsArea()
    if (after === before) stableRounds += 1
    else stableRounds = 0
    if (stableRounds >= 4) break
  }
  debug.push(`single_page added=${seen.size}`)

  ;(window as any).__leadiyaPaginationDebug = debug
  return Array.from(seen)
}

function isFirmPage(): boolean {
  return /2gis\.\w+\/[^/]+\/(firm|geo)\//.test(window.location.href)
}

function isSearchPage(): boolean {
  return /2gis\.\w+\/[^/]+\/search\//.test(window.location.href)
}

const AUTO_EXTRACT_COOLDOWN_MS = 4_000
const AUTO_EXTRACT_WAIT_MS = 700
const AUTO_EXTRACT_MAX_ATTEMPTS = 5
let lastAutoAt = 0
let lastAutoUrl = ''
let autoModeEnabled = false
let autoExtractInFlight = false

function runtimeAvailable(): boolean {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

function safeSendToBackground(message: unknown) {
  if (!runtimeAvailable()) return
  try {
    chrome.runtime.sendMessage(message, () => {
      // Consume runtime errors (e.g., background restarted) without throwing in content script.
      void chrome.runtime.lastError
    })
  } catch {
    // ignore
  }
}

async function tryAutoExtract(reason: string) {
  if (!autoModeEnabled) return
  if (autoExtractInFlight) return
  const now = Date.now()
  if (!isFirmPage()) return
  if (window.location.href === lastAutoUrl && now - lastAutoAt < AUTO_EXTRACT_COOLDOWN_MS) return
  autoExtractInFlight = true
  try {
    let data = await extractFirmDataWithPhoneReveal()
    // 2GIS renders rubric/category slightly after title; wait briefly to avoid "Без категории" on autopilot captures.
    for (let i = 1; i < AUTO_EXTRACT_MAX_ATTEMPTS && data.name && !data.category; i++) {
      await sleep(AUTO_EXTRACT_WAIT_MS)
      data = extractFirmData()
    }
    if (!data.name) return
    lastAutoAt = now
    lastAutoUrl = window.location.href
    safeSendToBackground({ action: 'autoExtracted', data, reason })
  } finally {
    autoExtractInFlight = false
  }
}


function installUrlChangeHook(onChange: () => void) {
  const wrap = (fn: typeof history.pushState) =>
    function wrapped(this: History, ...args: Parameters<typeof history.pushState>) {
      const r = fn.apply(this, args as any)
      onChange()
      return r
    }

  history.pushState = wrap(history.pushState.bind(history))
  history.replaceState = wrap(history.replaceState.bind(history))
  window.addEventListener('popstate', onChange)
  window.addEventListener('hashchange', onChange)
}

export default defineContentScript({
  matches: ['*://*.2gis.kz/*', '*://*.2gis.ru/*', '*://*.2gis.com/*'],

  main() {
    if (!runtimeAvailable()) return
    console.log('[Leadiya] Content script loaded on', window.location.href)

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action === 'extractFirm') {
        if (!isFirmPage()) {
          sendResponse({ success: false, error: 'Это не карточка компании' })
          return true
        }
        extractFirmDataWithPhoneReveal()
          .then((data) => {
            if (!data.name) {
              sendResponse({ success: false, error: 'Не удалось получить название компании' })
              return
            }
            sendResponse({ success: true, data })
          })
          .catch((err) => {
            sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            })
          })
        return true
      }

      if (message.action === 'collectFirmLinks') {
        if (!isSearchPage()) {
          sendResponse({ success: false, error: 'Это не страница поиска' })
          return true
        }
        const maxPages = Number(message.maxPages ?? 3)
        collectFirmLinksPaginated(Number.isFinite(maxPages) ? maxPages : 3)
          .then((links) => {
            const debug = ((window as any).__leadiyaPaginationDebug || []) as string[]
            sendResponse({ success: true, links, debug })
          })
          .catch((err) => {
            sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            })
          })
        return true
      }

      if (message.action === 'getPageType') {
        sendResponse({
          isFirm: isFirmPage(),
          isSearch: isSearchPage(),
          url: window.location.href,
        })
        return true
      }

      return false
    })

    chrome.storage.local.get('autoMode', (result) => {
      autoModeEnabled = Boolean(result.autoMode)
      if (autoModeEnabled) {
        tryAutoExtract('init')
      }

      installUrlChangeHook(() => {
        tryAutoExtract('route-change')
      })
      // Fallback for SPA view updates where URL changes are not emitted.
      setInterval(() => {
        tryAutoExtract('interval')
      }, 1500)
    })

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !('autoMode' in changes)) return
      autoModeEnabled = Boolean(changes.autoMode?.newValue)
      if (autoModeEnabled) {
        tryAutoExtract('auto-enabled')
      }
    })

    mountLeadiyaDock({
      isFirm: isFirmPage,
      isSearch: isSearchPage,
      getHref: () => window.location.href,
    })
  },
})

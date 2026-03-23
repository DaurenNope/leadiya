import { defineContentScript } from 'wxt/utils/define-content-script'

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

function extractFirmData(): LeadData {
  const name = getText('h1')

  const address = getText('address') || getText('[class*="address"]')

  const phones = getLinks('a[href^="tel:"]')

  const emails = getLinks('a[href^="mailto:"]').map((e) => e.replace('mailto:', ''))

  const websiteRaw = getLinks('a[href*="link.2gis.com"]:not([aria-label])')[0] || ''
  const website = decode2GisLink(websiteRaw)

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
  }
}

function collectFirmLinks(): string[] {
  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href*="/firm/"]')
  const seen = new Set<string>()
  const links: string[] = []
  for (const a of anchors) {
    const href = a.href.split('?')[0]
    if (!seen.has(href)) {
      seen.add(href)
      links.push(href)
    }
  }
  return links
}

function isFirmPage(): boolean {
  return /2gis\.\w+\/[^/]+\/firm\//.test(window.location.href)
}

function isSearchPage(): boolean {
  return /2gis\.\w+\/[^/]+\/search\//.test(window.location.href)
}

export default defineContentScript({
  matches: ['*://*.2gis.kz/*', '*://*.2gis.ru/*', '*://*.2gis.com/*'],

  main() {
    console.log('[Leadiya] Content script loaded on', window.location.href)

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action === 'extractFirm') {
        if (!isFirmPage()) {
          sendResponse({ success: false, error: 'Not a firm page' })
          return true
        }
        const data = extractFirmData()
        if (!data.name) {
          sendResponse({ success: false, error: 'Could not extract firm name' })
          return true
        }
        sendResponse({ success: true, data })
        return true
      }

      if (message.action === 'collectFirmLinks') {
        if (!isSearchPage()) {
          sendResponse({ success: false, error: 'Not a search page' })
          return true
        }
        const links = collectFirmLinks()
        sendResponse({ success: true, links })
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
      if (result.autoMode && isFirmPage()) {
        const data = extractFirmData()
        if (data.name) {
          chrome.runtime.sendMessage({ action: 'autoExtracted', data })
        }
      }
    })
  },
})

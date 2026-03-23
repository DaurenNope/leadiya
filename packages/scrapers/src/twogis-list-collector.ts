import type { Page, Response } from 'playwright'

/** How firm URLs are collected on the 2GIS search page (browser-only; no paid Catalog API from our servers). */
export type TwogisListStrategy = 'dom' | 'network' | 'hybrid'

export interface TwogisListPhaseMetrics {
  strategy: TwogisListStrategy
  domMs: number
  networkWallMs: number
  domLinkCount: number
  networkLinkCount: number
  unionLinkCount: number
  overlapCount: number
  onlyDomCount: number
  onlyNetworkCount: number
  catalogJsonResponses: number
  networkFallbackToDom: boolean
}

export function normalizeFirmUrl(href: string): string {
  try {
    const u = new URL(href, 'https://2gis.kz')
    u.hash = ''
    u.search = ''
    if (!u.pathname.includes('/firm/')) return href.trim()
    let out = u.toString()
    if (out.endsWith('/')) out = out.slice(0, -1)
    return out
  } catch {
    return href.trim()
  }
}

function shouldTryParseCatalogUrl(url: string): boolean {
  if (!/catalog\.api\.2gis\.(com|ru|kz)/i.test(url)) return false
  return /items|search|markers|list|branch|firm|\/3\.0\//i.test(url)
}

/**
 * Pull firm card URLs from Catalog JSON (embedded links, paths, or item ids).
 */
export function extractFirmUrlsFromJsonPayload(data: unknown): Set<string> {
  const out = new Set<string>()
  const add = (raw: string) => {
    const s = raw.trim()
    if (!s.includes('/firm/')) return
    try {
      if (s.startsWith('http')) out.add(normalizeFirmUrl(s))
      else if (s.startsWith('/')) out.add(normalizeFirmUrl(`https://2gis.kz${s}`))
    } catch {
      /* skip */
    }
  }

  const walk = (obj: unknown): void => {
    if (obj == null) return
    if (typeof obj === 'string') {
      if (obj.includes('/firm/')) {
        const abs = obj.match(/https?:\/\/2gis\.[^"'\\\s]+\/firm\/[a-zA-Z0-9_.-]+/gi)
        if (abs) for (const m of abs) add(m)
        const rel = obj.match(/\/[a-z]{2,24}\/firm\/[a-zA-Z0-9_.-]+/gi)
        if (rel) for (const m of rel) add(m)
        const bare = obj.match(/\/firm\/[a-zA-Z0-9_.-]+/gi)
        if (bare) for (const m of bare) add(m)
      }
      return
    }
    if (Array.isArray(obj)) {
      for (const x of obj) walk(x)
      return
    }
    if (typeof obj === 'object') {
      for (const v of Object.values(obj)) walk(v)
    }
  }

  walk(data)

  const root = data as Record<string, unknown> | null
  const result = root?.result
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const r = result as Record<string, unknown>
    const items =
      (r.items as unknown[]) ??
      (r.search_result as Record<string, unknown> | undefined)?.items ??
      (r.search as Record<string, unknown> | undefined)?.items
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const it = item as Record<string, unknown>
        const id = it.id ?? it.object_id ?? it.point_id ?? it.entity_id
        if (id != null && String(id).length > 4) {
          add(`https://2gis.kz/firm/${id}`)
        }
        walk(item)
      }
    }
  }

  return out
}

export function attachCatalogResponseTap(page: Page) {
  const urls = new Set<string>()
  let catalogJsonResponses = 0

  const handler = async (response: Response) => {
    if (!shouldTryParseCatalogUrl(response.url())) return
    if (response.status() !== 200) return
    try {
      const text = await response.text()
      if (!text || (text[0] !== '{' && text[0] !== '[')) return
      const data = JSON.parse(text) as unknown
      catalogJsonResponses++
      for (const u of extractFirmUrlsFromJsonPayload(data)) {
        urls.add(normalizeFirmUrl(u))
      }
    } catch {
      /* body not JSON or parse error */
    }
  }

  page.on('response', handler)
  return {
    snapshot: () => ({
      urls: new Set(urls),
      catalogJsonResponses,
    }),
    dispose: () => {
      page.off('response', handler)
    },
  }
}

export interface ListPhaseScrollConfig {
  initialWaitMs: number
  maxScrolls: number
  scrollWaitMs: number
}

/**
 * DOM: scroll + anchor scan only.
 * Network: tap catalog.api.2gis JSON during goto + scroll (no DOM link harvest); falls back to DOM if zero URLs.
 * Hybrid: tap + DOM scroll (union); logs overlap for comparison.
 */
export async function runSearchListPhase(
  page: Page,
  searchUrl: string,
  strategy: TwogisListStrategy,
  collectDomLinks: (page: Page) => Promise<string[]>,
  scroll: ListPhaseScrollConfig
): Promise<{ links: string[]; metrics: TwogisListPhaseMetrics }> {
  const { initialWaitMs, maxScrolls, scrollWaitMs } = scroll

  if (strategy === 'dom') {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(initialWaitMs)
    const d0 = Date.now()
    const domLinks = await collectDomLinks(page)
    const domMs = Date.now() - d0
    const domSet = new Set(domLinks.map(normalizeFirmUrl))
    return {
      links: [...domSet],
      metrics: {
        strategy: 'dom',
        domMs,
        networkWallMs: 0,
        domLinkCount: domSet.size,
        networkLinkCount: 0,
        unionLinkCount: domSet.size,
        overlapCount: 0,
        onlyDomCount: domSet.size,
        onlyNetworkCount: 0,
        catalogJsonResponses: 0,
        networkFallbackToDom: false,
      },
    }
  }

  async function scrollForNetworkTriggers(): Promise<void> {
    for (let i = 0; i < maxScrolls; i++) {
      await page.evaluate(() => window.scrollBy(0, 3000))
      await page.waitForTimeout(scrollWaitMs)
    }
  }

  if (strategy === 'network') {
    const tap = attachCatalogResponseTap(page)
    const nw0 = Date.now()
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(initialWaitMs)
    await scrollForNetworkTriggers()
    const snap = tap.snapshot()
    tap.dispose()
    const networkWallMs = Date.now() - nw0
    const netSet = new Set([...snap.urls].map(normalizeFirmUrl))

    if (netSet.size === 0) {
      const d0 = Date.now()
      const domLinks = await collectDomLinks(page)
      const domMs = Date.now() - d0
      const domSet = new Set(domLinks.map(normalizeFirmUrl))
      return {
        links: [...domSet],
        metrics: {
          strategy: 'network',
          domMs,
          networkWallMs,
          domLinkCount: domSet.size,
          networkLinkCount: 0,
          unionLinkCount: domSet.size,
          overlapCount: 0,
          onlyDomCount: domSet.size,
          onlyNetworkCount: 0,
          catalogJsonResponses: snap.catalogJsonResponses,
          networkFallbackToDom: true,
        },
      }
    }

    return {
      links: [...netSet],
      metrics: {
        strategy: 'network',
        domMs: 0,
        networkWallMs,
        domLinkCount: 0,
        networkLinkCount: netSet.size,
        unionLinkCount: netSet.size,
        overlapCount: 0,
        onlyDomCount: 0,
        onlyNetworkCount: netSet.size,
        catalogJsonResponses: snap.catalogJsonResponses,
        networkFallbackToDom: false,
      },
    }
  }

  // hybrid
  const tap = attachCatalogResponseTap(page)
  const wall0 = Date.now()
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(initialWaitMs)
  const d0 = Date.now()
  const domLinks = await collectDomLinks(page)
  const domMs = Date.now() - d0
  const snap = tap.snapshot()
  tap.dispose()
  const networkWallMs = Date.now() - wall0

  const domSet = new Set(domLinks.map(normalizeFirmUrl))
  const netSet = new Set([...snap.urls].map(normalizeFirmUrl))
  let overlap = 0
  for (const u of domSet) {
    if (netSet.has(u)) overlap++
  }
  const union = new Set<string>([...domSet, ...netSet])

  return {
    links: [...union],
    metrics: {
      strategy: 'hybrid',
      domMs,
      networkWallMs,
      domLinkCount: domSet.size,
      networkLinkCount: netSet.size,
      unionLinkCount: union.size,
      overlapCount: overlap,
      onlyDomCount: domSet.size - overlap,
      onlyNetworkCount: netSet.size - overlap,
      catalogJsonResponses: snap.catalogJsonResponses,
      networkFallbackToDom: false,
    },
  }
}

export function formatListMetricsLog(
  city: string,
  category: string,
  m: TwogisListPhaseMetrics
): string {
  return (
    `[2GIS:list] ${city} / ${category} strategy=${m.strategy} ` +
    `catalogResponses=${m.catalogJsonResponses} ` +
    `dom=${m.domLinkCount} net=${m.networkLinkCount} union=${m.unionLinkCount} ` +
    `overlap=${m.overlapCount} onlyDom=${m.onlyDomCount} onlyNet=${m.onlyNetworkCount} ` +
    `domMs=${m.domMs} netWallMs=${m.networkWallMs} fallbackDom=${m.networkFallbackToDom}`
  )
}

/**
 * Backfill `twogis_card_category` from existing 2GIS firm URLs — no list-phase rescrape.
 * Opens each lead's `source_url` (detail page) and runs the same card extraction as discovery.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-twogis-card-category.ts
 *   npx tsx --env-file=.env scripts/backfill-twogis-card-category.ts --apply
 *   npx tsx --env-file=.env scripts/backfill-twogis-card-category.ts --apply --limit=200 --delay-ms=2500
 */
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { db, leads } from '@leadiya/db'
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { scrapeCompanyDetail } from '@leadiya/scrapers'
import { env } from '@leadiya/config'

chromium.use(StealthPlugin())

const APPLY = process.argv.includes('--apply')
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Math.max(1, parseInt(LIMIT_ARG.split('=')[1] || '500', 10)) : 500
const DELAY_ARG = process.argv.find((a) => a.startsWith('--delay-ms='))
const DELAY_MS = DELAY_ARG ? Math.max(0, parseInt(DELAY_ARG.split('=')[1] || '2000', 10)) : 2000

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
  if (u.includes('placeholder') || p.includes('placeholder')) return null
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@gate.smartproxy.com:7000`
}

function normFirmUrl(raw: string): string {
  try {
    const u = new URL(raw.trim())
    u.hash = ''
    let s = u.href
    if (s.endsWith('/')) s = s.slice(0, -1)
    return s
  } catch {
    return raw.trim()
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  console.log(
    `Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | limit=${LIMIT} leads | delay=${DELAY_MS}ms between unique URLs`,
  )

  const rows = await db
    .select({ id: leads.id, sourceUrl: leads.sourceUrl })
    .from(leads)
    .where(
      and(
        inArray(leads.source, ['2gis', '2gis-extension']),
        isNotNull(leads.sourceUrl),
        sql`trim(${leads.sourceUrl}) <> ''`,
        sql`(${leads.sourceUrl} ilike '%2gis%' or ${leads.sourceUrl} ilike '%link.2gis%')`,
        or(isNull(leads.twogisCardCategory), eq(leads.twogisCardCategory, '')),
      ),
    )
    .orderBy(asc(leads.createdAt))
    .limit(LIMIT)

  const byUrl = new Map<string, string[]>()
  for (const r of rows) {
    const u = r.sourceUrl?.trim()
    if (!u) continue
    const key = normFirmUrl(u)
    if (!byUrl.has(key)) byUrl.set(key, [])
    byUrl.get(key)!.push(r.id)
  }

  console.log(`Fetched ${rows.length} lead row(s) → ${byUrl.size} unique firm URL(s)`)

  if (byUrl.size === 0) {
    console.log('Nothing to do.')
    return
  }

  const proxyUrl = buildProxyUrl()
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox'],
    ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
  })

  let done = 0
  let updated = 0
  let failed = 0
  let skipped = 0

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

    for (const [url, ids] of byUrl) {
      done++
      process.stdout.write(`[${done}/${byUrl.size}] ${ids.length} lead(s) ← ${url.slice(0, 88)}… `)

      let label: string | null = null
      try {
        const details = await scrapeCompanyDetail(page, url)
        label = details?.twogisCardCategory ?? null
        if (!label?.trim()) {
          console.log('no card categories parsed')
          skipped++
        } else {
          console.log(`→ "${label.slice(0, 80)}${label.length > 80 ? '…' : ''}"`)
        }
      } catch (e) {
        failed++
        console.log(`ERROR: ${e instanceof Error ? e.message : e}`)
      }

      if (APPLY && label?.trim()) {
        await db
          .update(leads)
          .set({ twogisCardCategory: label.trim(), updatedAt: new Date() })
          .where(inArray(leads.id, ids))
        updated += ids.length
      }

      if (DELAY_MS > 0 && done < byUrl.size) await sleep(DELAY_MS)
    }

    await page.close().catch(() => {})
    await context.close().catch(() => {})
  } finally {
    await browser.close().catch(() => {})
  }

  console.log(
    `\nDone. unique URLs processed: ${byUrl.size} | leads touched (apply): ${updated} | no label: ${skipped} | fetch errors: ${failed}`,
  )
  if (!APPLY) {
    console.log('Dry-run: no DB writes. Pass --apply to set twogis_card_category.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

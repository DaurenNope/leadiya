/**
 * Smoke tests for Stage 2 HTML extraction (no DB).
 * Run: npx tsx scripts/test-stage2-http.ts
 */
import {
  extractEmailsFromHtml,
  extractLinksFromHtml,
} from '../packages/scrapers/src/enrichment.js'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

const base = 'https://example.com/page'

// --- Fixtures
const htmlMixed = `
<html><body>
  <a href="/contact">Контакты</a>
  <a href="mailto:hello@firm.kz?subject=Hi">mail</a>
  <p>Reach us at support@firm.kz or info@example.com</p>
</body></html>
`

const emails = extractEmailsFromHtml(htmlMixed, base)
assert(emails.includes('hello@firm.kz'), 'mailto email missing')
assert(emails.includes('support@firm.kz'), 'regex email missing')
assert(emails.includes('info@example.com'), 'second regex email missing')

const links = extractLinksFromHtml(htmlMixed, base)
const contact = links.find((l) => l.href.endsWith('/contact'))
assert(!!contact && contact.text.includes('контакт'), 'contact link not resolved')

async function main() {
  // --- Live fetch (optional network)
  const url = process.env.STAGE2_TEST_URL || 'https://example.com/'
  const res = await fetch(url, {
    headers: { 'User-Agent': 'leadiya-stage2-test/1.0' },
  })
  const liveHtml = await res.text()
  const liveEmails = extractEmailsFromHtml(liveHtml, url)
  const liveLinks = extractLinksFromHtml(liveHtml, url)
  console.log('Stage 2 HTTP extract smoke OK')
  console.log(`  fixture emails: ${emails.length}, links: ${links.length}`)
  console.log(`  live ${url} → status ${res.status}, emails ${liveEmails.length}, links ${liveLinks.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

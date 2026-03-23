/**
 * Read-only report: lead counts, fill rates, recent 2GIS samples.
 *
 *   npx tsx --env-file=.env scripts/evaluate-leads-quality.ts
 *   npx tsx --env-file=.env scripts/evaluate-leads-quality.ts --hours=24
 *   npx tsx --env-file=.env scripts/evaluate-leads-quality.ts --hours=72 --education
 *   npx tsx --env-file=.env scripts/evaluate-leads-quality.ts --education-only --hours=168
 */
import { db, leads, contacts } from '@leadiya/db'
import { sql, desc, gte, eq, and, or, isNotNull, inArray, ilike } from 'drizzle-orm'

const hoursArg = process.argv.find((a) => a.startsWith('--hours='))
const hours = hoursArg ? Math.max(1, parseInt(hoursArg.split('=')[1] || '24', 10)) : 24
const educationMode = process.argv.includes('--education')
const educationOnly = process.argv.includes('--education-only')

/** Same category list as scripts/scrape-education-hei.ts */
const EDU_CATEGORIES_EXACT = [
  'Университеты',
  'Институты',
  'Академии',
  'Колледжи',
  'Высшие учебные заведения',
  'Негосударственные вузы',
  'Бизнес-школы',
  'Филиалы университетов',
] as const

/** 2GIS rows that look like HEI / education orgs (matches HEI scraper intent). */
function heiCategoryOr() {
  return or(
    inArray(leads.category, [...EDU_CATEGORIES_EXACT]),
    ilike(leads.category, '%университет%'),
    ilike(leads.category, '%институт%'),
    ilike(leads.category, '%академи%'),
    ilike(leads.category, '%колледж%'),
    ilike(leads.category, '%высшие учебные%'),
    ilike(leads.category, '%негосударственные вуз%'),
    ilike(leads.category, '%бизнес-школ%'),
    ilike(leads.category, '%филиал%')
  )
}

const hei2gis = and(eq(leads.source, '2gis'), heiCategoryOr())

function pct(part: number, whole: number): string {
  if (whole <= 0) return '—'
  return `${((100 * part) / whole).toFixed(1)}%`
}

async function reportEducation(since: Date) {
  const createdBatch = and(hei2gis, gte(leads.createdAt, since))

  const [allHei] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(hei2gis)
  const [createdN] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(createdBatch)

  const [cSite] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(createdBatch, isNotNull(leads.website), sql`trim(${leads.website}) != ''`))
  const [cUrl] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(createdBatch, isNotNull(leads.sourceUrl), sql`trim(${leads.sourceUrl}) != ''`))
  const [cEmail] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(createdBatch, isNotNull(leads.email), sql`trim(${leads.email}) != ''`))
  const [cWa] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(createdBatch, isNotNull(leads.whatsapp), sql`trim(${leads.whatsapp}) != ''`))
  const [cTg] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(createdBatch, isNotNull(leads.telegram), sql`trim(${leads.telegram}) != ''`))
  const [cRating] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(createdBatch, isNotNull(leads.rating2gis), sql`trim(${leads.rating2gis}) != ''`))
  const [cReviews] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(createdBatch, sql`coalesce(${leads.reviewsCount2gis}, 0) > 0`))

  const [phoneBatch] = await db
    .select({ n: sql<number>`count(distinct ${contacts.leadId})::int` })
    .from(contacts)
    .innerJoin(leads, eq(contacts.leadId, leads.id))
    .where(
      and(
        createdBatch,
        isNotNull(contacts.phone),
        sql`trim(${contacts.phone}) != ''`
      )
    )

  const byCity = await db
    .select({
      city: leads.city,
      n: sql<number>`count(*)::int`,
    })
    .from(leads)
    .where(createdBatch)
    .groupBy(leads.city)
    .orderBy(desc(sql`count(*)`))

  const byCategory = await db
    .select({
      category: leads.category,
      n: sql<number>`count(*)::int`,
    })
    .from(leads)
    .where(createdBatch)
    .groupBy(leads.category)
    .orderBy(desc(sql`count(*)`))

  const dupGroups = await db
    .select({
      cnt: sql<number>`count(*)::int`,
    })
    .from(leads)
    .where(hei2gis)
    .groupBy(
      sql`lower(trim(coalesce(${leads.name}, '')))`,
      sql`lower(trim(coalesce(${leads.city}, '')))`
    )
    .having(sql`count(*) > 1`)

  const dupLeadRows = dupGroups.reduce((s, r) => s + (r.cnt - 1), 0)

  const samples = await db
    .select({
      name: leads.name,
      city: leads.city,
      category: leads.category,
      website: leads.website,
      sourceUrl: leads.sourceUrl,
      whatsapp: leads.whatsapp,
      rating2gis: leads.rating2gis,
      reviewsCount2gis: leads.reviewsCount2gis,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(createdBatch)
    .orderBy(desc(leads.createdAt))
    .limit(25)

  const n = createdN?.n ?? 0

  console.log('')
  console.log('══════════════════════════════════════════════════════════')
  console.log('EDUCATION / HEI DATA EVALUATION (2GIS, category ~ HEI)')
  console.log('══════════════════════════════════════════════════════════')
  console.log('')
  console.log(`  HEI-shaped leads (all time, source=2gis):  ${allHei?.n ?? 0}`)
  console.log(`  Created in last ${hours}h (this batch window): ${n}`)
  console.log('')
  if (n === 0) {
    console.log('  No HEI-shaped leads created in this window — try --hours=168 or run without --education.')
    console.log('══════════════════════════════════════════════════════════')
    console.log('')
    return
  }

  console.log(`Coverage of the ${n} lead(s) created in the last ${hours}h`)
  console.log(`  sourceUrl (2GIS card):  ${cUrl?.n ?? 0}  (${pct(cUrl?.n ?? 0, n)})`)
  console.log(`  website:                  ${cSite?.n ?? 0}  (${pct(cSite?.n ?? 0, n)})`)
  console.log(`  ≥1 phone in contacts:     ${phoneBatch?.n ?? 0}  (${pct(phoneBatch?.n ?? 0, n)})`)
  console.log(`  email on lead:            ${cEmail?.n ?? 0}  (${pct(cEmail?.n ?? 0, n)})`)
  console.log(`  whatsapp on lead:         ${cWa?.n ?? 0}  (${pct(cWa?.n ?? 0, n)})`)
  console.log(`  telegram on lead:         ${cTg?.n ?? 0}  (${pct(cTg?.n ?? 0, n)})`)
  console.log(`  2GIS rating text:         ${cRating?.n ?? 0}  (${pct(cRating?.n ?? 0, n)})`)
  console.log(`  reviews_count > 0:        ${cReviews?.n ?? 0}  (${pct(cReviews?.n ?? 0, n)})`)
  console.log('')

  console.log('By city (created in window)')
  console.log('─'.repeat(50))
  for (const r of byCity) {
    console.log(`  ${r.city ?? '(null)'}: ${r.n}`)
  }
  console.log('')

  console.log('By 2GIS category (created in window)')
  console.log('─'.repeat(50))
  for (const r of byCategory) {
    console.log(`  ${r.category ?? '(null)'}: ${r.n}`)
  }
  console.log('')

  console.log('Duplicate check (all-time HEI-shaped): same name+city, different rows')
  console.log(`  Groups with duplicates: ${dupGroups.length}  (~${dupLeadRows} redundant rows if merged)`)
  console.log('')

  console.log(`Samples (up to 25, newest first, created in last ${hours}h)`)
  console.log('─'.repeat(60))
  for (const r of samples) {
    const urlOk = r.sourceUrl ? 'card:yes' : 'card:no'
    const web = r.website ? 'web:yes' : 'web:no'
    console.log(`• ${r.name ?? '?'} | ${r.city ?? '?'} | ${r.category ?? '?'}`)
    console.log(`  ${urlOk} ${web} | ★${r.rating2gis ?? '—'} reviews:${r.reviewsCount2gis ?? 0} | ${r.createdAt?.toISOString?.() ?? ''}`)
  }

  console.log('')
  console.log('Verdict (heuristic)')
  const urlRate = (cUrl?.n ?? 0) / n
  const siteRate = (cSite?.n ?? 0) / n
  const phoneRate = (phoneBatch?.n ?? 0) / n
  if (urlRate >= 0.9 && siteRate >= 0.5) {
    console.log('  Strong: most rows have a stable 2GIS URL and many have own websites — good for outreach / enrichment.')
  } else if (urlRate >= 0.8) {
    console.log('  OK: card URLs are mostly present; enrich websites where missing.')
  } else {
    console.log('  Weak: many missing sourceUrl — check scraper extraction or blocked pages.')
  }
  if (phoneRate < 0.3) {
    console.log('  Phones: low vs HEI expectations — detail pages may need richer contact parsing or manual pass.')
  }
  console.log('══════════════════════════════════════════════════════════')
  console.log('')
}

async function main() {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000)

  if (educationOnly) {
    await reportEducation(since)
    return
  }

  const [totalRow] = await db.select({ n: sql<number>`count(*)::int` }).from(leads)
  const [recentRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(gte(leads.updatedAt, since))

  const [withPhone] = await db
    .select({ n: sql<number>`count(distinct ${contacts.leadId})::int` })
    .from(contacts)
    .where(and(isNotNull(contacts.phone), sql`${contacts.phone} != ''`))

  const [withWebsite] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(isNotNull(leads.website), sql`${leads.website} != ''`))

  const [withAddress] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(isNotNull(leads.address), sql`trim(${leads.address}) != ''`))

  const [withBin] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(isNotNull(leads.bin), sql`${leads.bin} ~ '^[0-9]{12}$'`))

  const bySource = await db
    .select({
      source: leads.source,
      n: sql<number>`count(*)::int`,
    })
    .from(leads)
    .groupBy(leads.source)

  const samples = await db
    .select({
      name: leads.name,
      city: leads.city,
      category: leads.category,
      website: leads.website,
      source: leads.source,
      rating2gis: leads.rating2gis,
      bin: leads.bin,
      address: leads.address,
      sourceUrl: leads.sourceUrl,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(
      and(
        gte(leads.updatedAt, since),
        or(eq(leads.source, '2gis'), eq(leads.source, '2gis-extension'))
      )
    )
    .orderBy(desc(leads.updatedAt))
    .limit(15)

  const phoneCounts = await db
    .select({
      leadId: contacts.leadId,
      n: sql<number>`count(*)::int`,
    })
    .from(contacts)
    .where(and(isNotNull(contacts.phone), sql`${contacts.phone} != ''`))
    .groupBy(contacts.leadId)
    .limit(5000)

  const avgPhones =
    phoneCounts.length > 0
      ? phoneCounts.reduce((s, r) => s + r.n, 0) / phoneCounts.length
      : 0

  console.log('')
  console.log('══════════════════════════════════════════════════════════')
  console.log(`LEAD DATA QUALITY REPORT (updated in last ${hours}h highlighted where noted)`)
  console.log('══════════════════════════════════════════════════════════')
  console.log('')
  console.log('Inventory')
  console.log(`  Total leads (all time):     ${totalRow?.n ?? 0}`)
  console.log(`  Updated in last ${hours}h:   ${recentRow?.n ?? 0}`)
  console.log('')
  console.log('Coverage (all leads in DB)')
  console.log(`  Leads with ≥1 phone row:   ${withPhone?.n ?? 0}`)
  console.log(`  Leads with website field:  ${withWebsite?.n ?? 0}`)
  console.log(`  Leads with non-empty addr: ${withAddress?.n ?? 0}`)
  console.log(`  Leads with valid 12-digit BIN: ${withBin?.n ?? 0}`)
  console.log(`  Avg phone rows / lead (sample of leads that have phones): ${avgPhones.toFixed(2)}`)
  console.log('')
  console.log('By source')
  for (const row of bySource) {
    console.log(`  ${row.source ?? '(null)'}: ${row.n}`)
  }
  console.log('')
  console.log(`Recent 2GIS / extension samples (up to 15, last ${hours}h)`)
  console.log('─'.repeat(60))
  for (const r of samples) {
    const addr = r.address ? (r.address.length > 40 ? r.address.slice(0, 40) + '…' : r.address) : '—'
    const web = r.website ? 'yes' : 'no'
    const bin = r.bin ? 'yes' : 'no'
    console.log(`• ${r.name ?? '?'} | ${r.city ?? '?'} | ${r.category ?? '?'} | site:${web} bin:${bin} | ★${r.rating2gis ?? '—'}`)
    console.log(`  addr: ${addr}`)
    console.log(`  ${r.source} | ${r.updatedAt?.toISOString?.() ?? ''}`)
  }
  if (samples.length === 0) {
    console.log('  (none in window — widen with --hours=168)')
  }
  console.log('')
  console.log('Quality heuristics (interpretation)')
  console.log('  • Good: name + city + sourceUrl present; phones in `contacts`; website decoded (not only link.2gis)')
  console.log('  • Weak: empty address common on SPA (2GIS often hides in non-semantic DOM)')
  console.log('  • BIN: only when shown on card; many SMEs won’t have it')
  console.log('══════════════════════════════════════════════════════════')
  console.log('')

  if (educationMode) {
    await reportEducation(since)
  } else {
    console.log('Tip: for HEI/education runs, add  --education  (optional --education-only --hours=72)')
    console.log('')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

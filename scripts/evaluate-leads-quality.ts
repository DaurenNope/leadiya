/**
 * Read-only report: lead counts, fill rates, recent 2GIS samples.
 *
 *   npx tsx --env-file=.env scripts/evaluate-leads-quality.ts
 *   npx tsx --env-file=.env scripts/evaluate-leads-quality.ts --hours=24
 */
import { db, leads, contacts } from '@leadiya/db'
import { sql, desc, gte, eq, and, or, isNotNull } from 'drizzle-orm'

const hoursArg = process.argv.find((a) => a.startsWith('--hours='))
const hours = hoursArg ? Math.max(1, parseInt(hoursArg.split('=')[1] || '24', 10)) : 24

async function main() {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000)

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
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

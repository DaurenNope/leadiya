/**
 * Merge duplicate leads caused by city alias mismatch (e.g. "almaty" vs "Алматы").
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/dedupe-city-alias-collisions.ts
 *   npx tsx --env-file=.env scripts/dedupe-city-alias-collisions.ts --apply
 */
import { db, leads } from '@leadiya/db'
import { asc, eq, sql } from 'drizzle-orm'
import { resolveCity } from '../apps/extension/lib/city.js'

const APPLY = process.argv.includes('--apply')

type LeadRow = {
  id: string
  name: string | null
  city: string | null
  category: string | null
  website: string | null
  email: string | null
  sourceUrl: string | null
  address: string | null
  createdAt: Date
}

function textScore(v: string | null | undefined): number {
  return v && v.trim().length > 0 ? 1 : 0
}

function categoryScore(v: string | null | undefined): number {
  if (!v || !v.trim()) return 0
  if (v === 'Без категории') return 0
  return 2
}

function isLikelyCanonicalCity(city: string | null, resolved: string): boolean {
  if (!city) return false
  return city.trim() === resolved
}

function scoreLead(row: LeadRow, resolvedCity: string): number {
  return (
    categoryScore(row.category) * 10 +
    textScore(row.website) * 4 +
    textScore(row.email) * 3 +
    textScore(row.address) * 2 +
    (isLikelyCanonicalCity(row.city, resolvedCity) ? 30 : 0)
  )
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  const rows = (await db
    .select({
      id: leads.id,
      name: leads.name,
      city: leads.city,
      category: leads.category,
      website: leads.website,
      email: leads.email,
      sourceUrl: leads.sourceUrl,
      address: leads.address,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(sql`${leads.source} in ('2gis', '2gis-extension')`)
    .orderBy(asc(leads.createdAt))) as LeadRow[]

  const bySourceAndName = new Map<string, LeadRow[]>()
  for (const row of rows) {
    const name = (row.name || '').trim().toLowerCase()
    const sourceUrl = (row.sourceUrl || '').trim().toLowerCase()
    if (!name || !sourceUrl) continue
    const key = `${name}::${sourceUrl}`
    const arr = bySourceAndName.get(key) || []
    arr.push(row)
    bySourceAndName.set(key, arr)
  }

  let groups = 0
  let merged = 0

  for (const dupes of bySourceAndName.values()) {
    if (dupes.length < 2) continue
    const resolvedCity = resolveCity(...dupes.map((d) => d.city || ''))
    const withScore = dupes
      .map((row) => ({ row, score: scoreLead(row, resolvedCity) }))
      .sort((a, b) => b.score - a.score || a.row.createdAt.getTime() - b.row.createdAt.getTime())
    const winner = withScore[0]!.row
    const losers = withScore.slice(1).map((x) => x.row)
    if (losers.length === 0) continue
    groups += 1

    console.log(`merge group: "${winner.name}" (${dupes.length} rows) -> keep ${winner.id}`)
    for (const loser of losers) {
      console.log(`  drop ${loser.id} city="${loser.city || ''}"`)
    }

    if (!APPLY) continue

    await db.transaction(async (tx) => {
      for (const loser of losers) {
        await tx.execute(sql`update contacts set lead_id = ${winner.id} where lead_id = ${loser.id}`)
        // Some environments may have older outreach schema; keep dedupe resilient.
        try {
          await tx.execute(sql`update outreach_log set lead_id = ${winner.id} where lead_id = ${loser.id}`)
        } catch {
          /* ignore schema mismatch */
        }
        await tx.execute(sql`update tenders set company_id = ${winner.id} where company_id = ${loser.id}`)
      }

      // Ensure canonical city on the kept row.
      await tx
        .update(leads)
        .set({
          city: resolvedCity,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, winner.id))

      for (const loser of losers) {
        await tx.execute(sql`delete from leads where id = ${loser.id}`)
        merged += 1
      }
    })
  }

  console.log('--- Dedupe report ---')
  console.log(`groups: ${groups}`)
  console.log(`merged: ${merged}`)
  console.log(APPLY ? 'APPLY completed.' : 'DRY-RUN completed. Re-run with --apply to persist.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})


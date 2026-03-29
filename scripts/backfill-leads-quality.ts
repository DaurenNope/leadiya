/**
 * Backfill city/category quality for existing leads without re-scraping.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-leads-quality.ts
 *   npx tsx --env-file=.env scripts/backfill-leads-quality.ts --apply
 *   npx tsx --env-file=.env scripts/backfill-leads-quality.ts --apply --limit=2000
 */
import { db, leads } from '@leadiya/db'
import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { sanitizeLeadPayload } from '../apps/api/src/lib/lead-quality.js'

const APPLY = process.argv.includes('--apply')
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? Math.max(1, parseInt(LIMIT_ARG.split('=')[1] || '5000', 10)) : 5000
const BATCH = 500

type LeadRow = {
  id: string
  name: string | null
  city: string | null
  category: string | null
  address: string | null
  email: string | null
  website: string | null
  instagram: string | null
  whatsapp: string | null
  telegram: string | null
  facebook: string | null
  bin: string | null
  rating2gis: string | null
  lat: string | null
  lng: string | null
  sourceUrl: string | null
  rawData: any
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | limit=${LIMIT}`)

  let offset = 0
  let scanned = 0
  let changed = 0
  let cityChanged = 0
  let categoryChanged = 0
  let qualityAdded = 0
  let collisions = 0
  let citySkippedDueCollision = 0

  while (scanned < LIMIT) {
    const take = Math.min(BATCH, LIMIT - scanned)
    const rows = (await db
      .select({
        id: leads.id,
        name: leads.name,
        city: leads.city,
        category: leads.category,
        address: leads.address,
        email: leads.email,
        website: leads.website,
        instagram: leads.instagram,
        whatsapp: leads.whatsapp,
        telegram: leads.telegram,
        facebook: leads.facebook,
        bin: leads.bin,
        rating2gis: leads.rating2gis,
        lat: leads.lat,
        lng: leads.lng,
        sourceUrl: leads.sourceUrl,
        rawData: leads.rawData,
      })
      .from(leads)
      .where(
        and(
          isNotNull(leads.name),
          or(eq(leads.source, '2gis-extension'), eq(leads.source, '2gis'))
        )
      )
      .orderBy(asc(leads.createdAt))
      .limit(take)
      .offset(offset)) as LeadRow[]

    if (rows.length === 0) break
    scanned += rows.length
    offset += rows.length

    for (const row of rows) {
      const sanitized = sanitizeLeadPayload({
        name: row.name || '',
        city: row.city || '',
        category: row.category || '',
        address: row.address || '',
        phones: [],
        emails: row.email ? [row.email] : [],
        website: row.website || '',
        instagram: row.instagram || '',
        whatsapp: row.whatsapp || '',
        telegram: row.telegram || '',
        facebook: row.facebook || '',
        bin: row.bin || '',
        rating: row.rating2gis ? Number(row.rating2gis) : null,
        lat: row.lat || '',
        lng: row.lng || '',
        sourceUrl: row.sourceUrl || '',
      })

      const nextCity = sanitized.city || null
      const nextCategory = sanitized.category || null
      const prevQuality = row.rawData && typeof row.rawData === 'object' ? row.rawData.quality : undefined
      const nextQuality = sanitized.quality

      const isCityChanged = (row.city || null) !== nextCity
      const isCategoryChanged = (row.category || null) !== nextCategory
      const isQualityChanged = JSON.stringify(prevQuality || null) !== JSON.stringify(nextQuality)
      if (!isCityChanged && !isCategoryChanged && !isQualityChanged) continue

      changed += 1
      if (isCityChanged) cityChanged += 1
      if (isCategoryChanged) categoryChanged += 1
      if (isQualityChanged) qualityAdded += 1

      if (!APPLY) continue

      const mergedRaw =
        row.rawData && typeof row.rawData === 'object'
          ? { ...row.rawData, quality: nextQuality }
          : { quality: nextQuality }

      try {
        await db
          .update(leads)
          .set({
            city: nextCity,
            category: nextCategory,
            rawData: mergedRaw,
            updatedAt: new Date(),
          })
          .where(eq(leads.id, row.id))
      } catch (err: any) {
        if (String(err?.code) === '23505' && isCityChanged) {
          collisions += 1
          citySkippedDueCollision += 1
          // Keep current city to avoid unique collision; still apply category/quality.
          await db
            .update(leads)
            .set({
              category: nextCategory,
              rawData: {
                ...(mergedRaw || {}),
                quality: {
                  ...(nextQuality as any),
                  flags: Array.from(new Set([...(nextQuality.flags || []), 'backfill_city_collision'])),
                },
              },
              updatedAt: new Date(),
            })
            .where(eq(leads.id, row.id))
        } else {
          throw err
        }
      }
    }
  }

  console.log('--- Backfill report ---')
  console.log(`scanned:        ${scanned}`)
  console.log(`changed:        ${changed}`)
  console.log(`city_changed:   ${cityChanged}`)
  console.log(`category_changed:${categoryChanged}`)
  console.log(`quality_upsert: ${qualityAdded}`)
  console.log(`collisions:     ${collisions}`)
  console.log(`city_skipped:   ${citySkippedDueCollision}`)
  console.log(APPLY ? 'APPLY completed.' : 'DRY-RUN completed. Re-run with --apply to persist.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})


import { Hono } from 'hono'
import { createHash, randomUUID } from 'node:crypto'
import { Queue } from 'bullmq'
import { z } from 'zod'
import { db, leads, contacts } from '@leadiya/db'
import { sql } from 'drizzle-orm'
import { env } from '@leadiya/config'
import type { AppEnv } from '../server.js'

const enrichmentQueue = new Queue('enrichment', { connection: { url: env.REDIS_URL } })

const leadsRouter = new Hono<AppEnv>()

function deterministicId(name: string, city: string): string {
  const seed = `${name.toLowerCase().trim()}|${city.toLowerCase().trim()}`
  const hash = createHash('sha256').update(seed).digest('hex').substring(0, 32)
  return hash.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
}

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

const leadSchema = z.object({
  name: z.string().min(1),
  city: z.string().optional().default(''),
  category: z.string().optional().default(''),
  address: z.string().optional().default(''),
  phones: z.array(z.string()).optional().default([]),
  emails: z.array(z.string()).optional().default([]),
  website: z.string().optional().default(''),
  instagram: z.string().optional().default(''),
  whatsapp: z.string().optional().default(''),
  telegram: z.string().optional().default(''),
  facebook: z.string().optional().default(''),
  bin: z.string().optional().default(''),
  rating: z.number().nullable().optional().default(null),
  lat: z.string().optional().default(''),
  lng: z.string().optional().default(''),
  sourceUrl: z.string().optional().default(''),
})

const bulkSchema = z.object({
  leads: z.array(leadSchema).min(1).max(500),
})

leadsRouter.post('/bulk', async (c) => {
  const body = await c.req.json()
  const result = bulkSchema.safeParse(body)

  if (!result.success) {
    return c.json(
      { error: 'Invalid payload', code: 'VALIDATION_ERROR', details: result.error.format() },
      400
    )
  }

  let inserted = 0
  let skipped = 0
  const newLeadIds: string[] = []

  for (const item of result.data.leads) {
    const normalizedName = item.name.trim()
    const city = item.city || 'KZ'

    if (await leadExists(normalizedName, city)) {
      skipped++
      continue
    }

    const leadId = deterministicId(normalizedName, city)

    try {
      const binValue = item.bin && item.bin.length === 12 ? item.bin : null

      await db
        .insert(leads)
        .values({
          id: leadId,
          name: normalizedName,
          bin: binValue,
          city: item.city || null,
          address: item.address || null,
          website: item.website || null,
          category: item.category || null,
          source: '2gis-extension',
          sourceUrl: item.sourceUrl || null,
          email: item.emails[0] || null,
          instagram: item.instagram || null,
          whatsapp: item.whatsapp || null,
          telegram: item.telegram || null,
          facebook: item.facebook || null,
          rating2gis: item.rating != null ? String(item.rating) : null,
          lat: item.lat || null,
          lng: item.lng || null,
          discoveryLevel: 1,
          status: 'valid',
        })
        .onConflictDoUpdate({
          target: leads.id,
          set: {
            updatedAt: new Date(),
            address: item.address || null,
            website: item.website || null,
            instagram: item.instagram || null,
            whatsapp: item.whatsapp || null,
            telegram: item.telegram || null,
            facebook: item.facebook || null,
            rating2gis: item.rating != null ? String(item.rating) : null,
            lat: item.lat || null,
            lng: item.lng || null,
            sourceUrl: item.sourceUrl || null,
          },
        })

      if (item.phones.length > 0) {
        for (const phone of item.phones) {
          await db
            .insert(contacts)
            .values({ leadId, phone, source: '2gis-extension', sourceUrl: item.sourceUrl || null })
            .onConflictDoNothing()
        }
      }

      if (item.emails.length > 0) {
        for (const email of item.emails) {
          await db
            .insert(contacts)
            .values({ leadId, email, source: '2gis-extension', sourceUrl: item.sourceUrl || null })
            .onConflictDoNothing()
        }
      }

      inserted++
    } catch (err) {
      console.error(`[leads/bulk] Error inserting ${normalizedName}:`, err)
      skipped++
    }
  }

  if (newLeadIds.length > 0) {
    await enrichmentQueue.add(
      'enrich',
      { leadIds: newLeadIds },
      {
        jobId: `enrich-extension:${randomUUID()}`,
        removeOnComplete: 200,
        removeOnFail: 500,
      }
    )
  }

  return c.json({ inserted, skipped, enrichmentQueued: newLeadIds.length })
})

export { leadsRouter }

import { Hono } from 'hono'
import { createHash, randomUUID } from 'node:crypto'
import { Queue } from 'bullmq'
import { z } from 'zod'
import { db, leads, contacts, eq } from '@leadiya/db'
import { sql } from 'drizzle-orm'
import { env } from '@leadiya/config'
import type { AppEnv } from '../types.js'
import { sanitizeLeadPayload } from '../lib/lead-quality.js'

const enrichmentQueue = new Queue('enrichment', { connection: { url: env.REDIS_URL } })

const leadsRouter = new Hono<AppEnv>()

function deterministicId(name: string, city: string): string {
  const seed = `${name.toLowerCase().trim()}|${city.toLowerCase().trim()}`
  const hash = createHash('sha256').update(seed).digest('hex').substring(0, 32)
  return hash.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
}

async function leadExists(name: string, city: string): Promise<string | null> {
  const existing = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      sql`LOWER(TRIM(${leads.name})) = LOWER(TRIM(${name})) AND LOWER(TRIM(${leads.city})) = LOWER(TRIM(${city}))`
    )
    .limit(1)
  return existing[0]?.id ?? null
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

type BulkItemResult = {
  index: number
  name: string
  city: string
  status: 'inserted' | 'duplicate' | 'rejected'
  leadId?: string
  reason?: string
}

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
  const results: BulkItemResult[] = []

  for (const [index, item] of result.data.leads.entries()) {
    const cleaned = sanitizeLeadPayload(item)
    const normalizedName = cleaned.name
    const city = cleaned.city

    const existingId = await leadExists(normalizedName, city)
    if (existingId) {
      // Keep category/source fields fresh for extension recaptures.
      await db
        .update(leads)
        .set({
          updatedAt: new Date(),
          city: cleaned.city || null,
          category: cleaned.category || null,
          sourceUrl: cleaned.sourceUrl || null,
          address: cleaned.address || null,
          website: cleaned.website || null,
          email: cleaned.emails[0] || null,
          instagram: cleaned.instagram || null,
          whatsapp: cleaned.whatsapp || null,
          telegram: cleaned.telegram || null,
          facebook: cleaned.facebook || null,
          rating2gis: cleaned.rating != null ? String(cleaned.rating) : null,
          lat: cleaned.lat || null,
          lng: cleaned.lng || null,
          rawData: {
            quality: cleaned.quality,
          },
        })
        .where(eq(leads.id, existingId))
        .catch(() => {})

      if (cleaned.phones.length > 0) {
        for (const phone of cleaned.phones) {
          await db
            .insert(contacts)
            .values({
              leadId: existingId,
              phone,
              source: '2gis-extension',
              sourceUrl: cleaned.sourceUrl || null,
            })
            .onConflictDoNothing()
        }
      }

      if (cleaned.emails.length > 0) {
        for (const email of cleaned.emails) {
          await db
            .insert(contacts)
            .values({
              leadId: existingId,
              email,
              source: '2gis-extension',
              sourceUrl: cleaned.sourceUrl || null,
            })
            .onConflictDoNothing()
        }
      }

      skipped++
      results.push({
        index,
        name: normalizedName,
        city,
        status: 'duplicate',
        leadId: existingId,
      })
      continue
    }

    const leadId = deterministicId(normalizedName, city)

    try {
      const binValue = cleaned.bin && cleaned.bin.length === 12 ? cleaned.bin : null

      const upserted = await db
        .insert(leads)
        .values({
          id: leadId,
          name: normalizedName,
          bin: binValue,
          city: cleaned.city || null,
          address: cleaned.address || null,
          website: cleaned.website || null,
          category: cleaned.category || null,
          source: '2gis-extension',
          sourceUrl: cleaned.sourceUrl || null,
          email: cleaned.emails[0] || null,
          instagram: cleaned.instagram || null,
          whatsapp: cleaned.whatsapp || null,
          telegram: cleaned.telegram || null,
          facebook: cleaned.facebook || null,
          rating2gis: cleaned.rating != null ? String(cleaned.rating) : null,
          lat: cleaned.lat || null,
          lng: cleaned.lng || null,
          discoveryLevel: 1,
          status: 'valid',
          rawData: {
            quality: cleaned.quality,
          },
        })
        .onConflictDoUpdate({
          target: leads.id,
          set: {
            updatedAt: new Date(),
            city: cleaned.city || null,
            category: cleaned.category || null,
            address: cleaned.address || null,
            website: cleaned.website || null,
            instagram: cleaned.instagram || null,
            whatsapp: cleaned.whatsapp || null,
            telegram: cleaned.telegram || null,
            facebook: cleaned.facebook || null,
            rating2gis: cleaned.rating != null ? String(cleaned.rating) : null,
            lat: cleaned.lat || null,
            lng: cleaned.lng || null,
            sourceUrl: cleaned.sourceUrl || null,
            rawData: {
              quality: cleaned.quality,
            },
          },
        })
        .returning({ id: leads.id })

      for (const row of upserted) {
        newLeadIds.push(row.id)
      }

      if (cleaned.phones.length > 0) {
        for (const phone of cleaned.phones) {
          await db
            .insert(contacts)
            .values({ leadId, phone, source: '2gis-extension', sourceUrl: cleaned.sourceUrl || null })
            .onConflictDoNothing()
        }
      }

      if (cleaned.emails.length > 0) {
        for (const email of cleaned.emails) {
          await db
            .insert(contacts)
            .values({ leadId, email, source: '2gis-extension', sourceUrl: cleaned.sourceUrl || null })
            .onConflictDoNothing()
        }
      }

      inserted++
      results.push({
        index,
        name: normalizedName,
        city,
        status: 'inserted',
        leadId,
      })
    } catch (err) {
      console.error(`[leads/bulk] Error inserting ${normalizedName}:`, err)
      skipped++
      results.push({
        index,
        name: normalizedName,
        city,
        status: 'rejected',
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (newLeadIds.length > 0) {
    await enrichmentQueue.add(
      'enrich',
      { leadIds: newLeadIds },
      {
        // BullMQ jobId cannot contain ':'.
        jobId: `enrich-extension-${randomUUID()}`,
        removeOnComplete: 200,
        removeOnFail: 500,
      }
    )
  }

  return c.json({ inserted, skipped, enrichmentQueued: newLeadIds.length, results })
})

export { leadsRouter }

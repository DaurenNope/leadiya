import { eq, and, sql } from 'drizzle-orm'
import { db } from './db.js'
import { contacts, leads } from './schema.js'
import type { FoundationLead } from './foundation-types.js'

/** Shape expected by `scripts/repair_leads_2.0.ts` (legacy JSON + relational contacts). */
export type RepairLeadRow = {
  id: string
  company_name: string | null
  source_data: Record<string, unknown>
  contacts: unknown[]
  signals: Record<string, unknown>
  created_at: Date
}

async function getAll(): Promise<RepairLeadRow[]> {
  const ls = await db.select().from(leads)
  const out: RepairLeadRow[] = []
  for (const l of ls) {
    const crs = await db.select().from(contacts).where(eq(contacts.leadId, l.id))
    const raw = (l.rawData as Record<string, unknown> | null) ?? {}
    const signals = (raw.signals as Record<string, unknown> | undefined) ?? {}
    out.push({
      id: l.id,
      company_name: l.name,
      source_data: raw,
      contacts: crs,
      signals,
      created_at: l.createdAt,
    })
  }
  return out
}

async function existsByEmail(email: string): Promise<boolean> {
  const row = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.email, email))
    .limit(1)
  return row.length > 0
}

async function existsByPhone(phone: string, leadId: string, tenantId: string): Promise<boolean> {
  const row = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.phone, phone), eq(contacts.leadId, leadId), eq(contacts.tenantId, tenantId)))
    .limit(1)
  return row.length > 0
}

/** Case-insensitive name match in the same spirit as the 2GIS scraper dedup. */
async function companyNameExists(name: string): Promise<boolean> {
  const row = await db
    .select({ id: leads.id })
    .from(leads)
    .where(sql`LOWER(TRIM(${leads.name})) = LOWER(TRIM(${name}))`)
    .limit(1)
  return row.length > 0
}

async function create(lead: FoundationLead): Promise<FoundationLead> {
  const primaryLoc = lead.locations[0]

  await db
    .insert(leads)
    .values({
      id: lead.id,
      name: lead.company.name,
      bin: lead.company.bin ?? null,
      city: primaryLoc?.city ?? null,
      address: primaryLoc?.address ?? null,
      source: lead.pipeline.source,
      status: 'valid',
      rawData: lead as unknown as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: leads.id,
      set: {
        updatedAt: new Date(),
        name: lead.company.name,
        bin: lead.company.bin ?? null,
        city: primaryLoc?.city ?? null,
        address: primaryLoc?.address ?? null,
        source: lead.pipeline.source,
        rawData: lead as unknown as Record<string, unknown>,
      },
    })

   for (const c of lead.contacts) {
     for (const p of c.phones ?? []) {
       if (!p.number) continue
       await db
         .insert(contacts)
         .values({
           id: crypto.randomUUID(),
           leadId: lead.id,
           tenantId: lead.tenantId,
           phone: p.number,
           source: p.source ?? lead.pipeline.source,
           isPrimary: p.isPrimary ?? false,
         })
         .onConflictDoNothing()
     }
    for (const e of c.emails ?? []) {
       if (!e.address) continue
       await db
         .insert(contacts)
         .values({
           id: crypto.randomUUID(),
           leadId: lead.id,
           tenantId: lead.tenantId,
           email: e.address,
           source: e.source ?? lead.pipeline.source,
           isPrimary: e.isPrimary ?? false,
         })
        .onConflictDoNothing()
    }
  }

  return lead
}

export const leadRepository = {
  existsByEmail,
  existsByPhone,
  companyNameExists,
  create,
  getAll,
}

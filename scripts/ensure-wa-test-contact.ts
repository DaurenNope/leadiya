/**
 * Attach the WhatsApp test number to LEADIYA_VERIFY_LEAD_ID so that:
 * - POST /send and verify:wa-two-numbers target the right phone
 * - Inbound messages match the lead (findLeadByJid: contacts.phone / leads.whatsapp)
 * - CRM / inbox show the same thread
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/ensure-wa-test-contact.ts
 *
 * Env: LEADIYA_VERIFY_LEAD_ID, DEFAULT_TENANT_ID, and phone from
 * LEADIYA_VERIFY_PHONE_OVERRIDE or FOUNDER_WHATSAPP (or pass --phone=+7...)
 */
import { db, contacts, leads, eq } from '@leadiya/db'

function digitsOnly(input: string): string {
  return input.replace(/\D/g, '')
}

function normalizeKzDisplay(d: string): string {
  if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1)
  if (d.length === 10) d = '7' + d
  if (d.length >= 12 && d.startsWith('77')) d = d.slice(1)
  if (d.length === 11 && d.startsWith('7')) return `+${d}`
  return d.length >= 10 ? `+${d}` : `+${d}`
}

async function main() {
  const argvPhone = process.argv.find((a) => a.startsWith('--phone='))?.split('=')[1]?.trim()
  const raw =
    argvPhone ||
    process.env.LEADIYA_VERIFY_PHONE_OVERRIDE?.trim() ||
    process.env.FOUNDER_WHATSAPP?.trim()
  const leadId = process.env.LEADIYA_VERIFY_LEAD_ID?.trim()
  const tenantId = process.env.DEFAULT_TENANT_ID?.trim()

  if (!leadId) {
    console.error('Set LEADIYA_VERIFY_LEAD_ID in .env')
    process.exit(1)
  }
  if (!raw) {
    console.error('Set LEADIYA_VERIFY_PHONE_OVERRIDE or FOUNDER_WHATSAPP, or pass --phone=+7...')
    process.exit(1)
  }
  if (!tenantId) {
    console.error('Set DEFAULT_TENANT_ID (uuid) for contacts row')
    process.exit(1)
  }

  const d = digitsOnly(raw)
  if (d.length < 10) {
    console.error('Invalid phone (need ≥10 digits)')
    process.exit(1)
  }
  const display = normalizeKzDisplay(d)

  await db.update(leads).set({ whatsapp: display, updatedAt: new Date() }).where(eq(leads.id, leadId))

  await db.delete(contacts).where(eq(contacts.phone, display))
  await db.insert(contacts).values({
    leadId,
    tenantId,
    phone: display,
    source: 'wa_test',
    isPrimary: true,
  })

  const masked = `${display.slice(0, 4)}…${display.slice(-3)}`
  console.log(`OK — lead ${leadId.slice(0, 8)}… whatsapp + contact set to ${masked}`)
  console.log('Next: restart workers if you changed WHATSAPP_BUSINESS_HOURS_*; run npm run verify:wa-two-numbers')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})

import type { LeadPayload } from '../lead-types'

/** One row matching CSV columns for Sheets append. */
export function rowFromLeadForSheets(lead: LeadPayload): string[] {
  const phonesJoined = (lead.phones || []).join('; ')
  const emailsJoined = (lead.emails || []).join('; ')
  return [
    lead.name || '',
    lead.city || '',
    lead.category || '',
    lead.address || '',
    phonesJoined,
    emailsJoined,
    lead.website || '',
    lead.instagram || '',
    lead.whatsapp || '',
    lead.telegram || '',
    lead.facebook || '',
    lead.bin || '',
    lead.rating != null ? String(lead.rating) : '',
    lead.lat || '',
    lead.lng || '',
    lead.sourceUrl || '',
  ]
}

export const SHEETS_HEADER_ROW: string[] = [
  'name',
  'city',
  'category',
  'address',
  'phones',
  'emails',
  'website',
  'instagram',
  'whatsapp',
  'telegram',
  'facebook',
  'bin',
  'rating',
  'lat',
  'lng',
  'sourceUrl',
]

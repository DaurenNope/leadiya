import type { LeadPayload } from './lead-types'

const CSV_COLS: (keyof LeadPayload | 'phonesJoined' | 'emailsJoined')[] = [
  'name',
  'city',
  'category',
  'address',
  'phonesJoined',
  'emailsJoined',
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

function escapeCsvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function rowFromLead(lead: LeadPayload): string[] {
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

export function leadsToCsv(leads: LeadPayload[]): string {
  const header = CSV_COLS.map((c) =>
    c === 'phonesJoined' ? 'phones' : c === 'emailsJoined' ? 'emails' : String(c)
  )
  const lines = [header.map(escapeCsvCell).join(',')]
  for (const lead of leads) {
    lines.push(rowFromLead(lead).map(escapeCsvCell).join(','))
  }
  return lines.join('\n') + '\n'
}

export function leadsToJsonPretty(leads: LeadPayload[]): string {
  return JSON.stringify(leads, null, 2) + '\n'
}

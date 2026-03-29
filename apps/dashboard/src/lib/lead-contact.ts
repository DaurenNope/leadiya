import type { Lead } from '../types'

/** Основной email: строка компании или первый контакт с почтой. */
export function primaryEmail(lead: Lead | null | undefined): string | null {
  if (!lead) return null
  const e = lead.email?.trim()
  if (e) return e
  return lead.contacts?.find((c) => c.email?.trim())?.email?.trim() ?? null
}

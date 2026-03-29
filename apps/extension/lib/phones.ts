const PHONE_RE = /(?:\+?\d[\d()\-\s]{6,}\d)/g
const REVEAL_PHONE_RE = /(показать\s*(телефон|телефоны|номер)|show\s*(phone|number))/i

function normalizePhone(raw: string): string {
  const plus = raw.trim().startsWith('+')
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  return plus ? `+${digits}` : digits
}

export function collectPhones(telLinks: string[], bodyText: string): string[] {
  const fromLinks = telLinks.map((v) => normalizePhone(v.replace(/^tel:/i, '')))
  const fromText = (bodyText.match(PHONE_RE) ?? []).map((v) => normalizePhone(v))
  return Array.from(new Set([...fromLinks, ...fromText])).filter((v) => v.length >= 9)
}

export function isPhoneRevealLabel(text: string): boolean {
  return REVEAL_PHONE_RE.test((text || '').trim())
}

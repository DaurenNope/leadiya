/** Digits only, Kazakhstan-style → wa.me (no API; opens WhatsApp app / web). */
export function phoneDigitsForWa(input: string | null | undefined): string | null {
  if (!input?.trim()) return null
  let d = input.replace(/\D/g, '')
  if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1)
  if (d.length === 10 && !d.startsWith('7')) d = '7' + d
  if (d.length === 11 && d.startsWith('7')) return d
  if (d.length >= 12 && d.startsWith('77')) d = d.slice(1)
  if (d.length === 11 && d.startsWith('7')) return d
  return d.length >= 10 ? d : null
}

export function waMeLink(phoneDigits: string, text?: string): string {
  const base = `https://wa.me/${phoneDigits}`
  if (text?.trim()) {
    return `${base}?text=${encodeURIComponent(text.slice(0, 1800))}`
  }
  return base
}

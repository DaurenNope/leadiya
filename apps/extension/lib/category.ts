const FALLBACK_CATEGORY = 'Без категории'

function cleanupCategory(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[|]+/g, ' ')
    .trim()
}

function isGarbageCategory(v: string): boolean {
  if (!v) return true
  if (v.length > 80) return true
  if (/https?:\/\//i.test(v)) return true
  if (/[?&=]/.test(v) && /%[0-9A-F]{2}/i.test(v)) return true
  if (/^(android|ios|app\s?store|google\s?play)$/i.test(v.trim())) return true
  return false
}

function canonicalize(v: string): string {
  const lower = v.toLowerCase()
  const map: Array<[RegExp, string]> = [
    [/(жк|жил(ой|ые)\s+комплекс|новострой)/i, 'Новостройки'],
    [/(кофе|кофейня|кафе)/i, 'Кафе'],
    [/(ресторан|ресто|бар|паб)/i, 'Рестораны и бары'],
    [/(стомат|клиник|медиц|больниц)/i, 'Медицина'],
    [/(университет|вуз|институт|колледж|школ)/i, 'Образование'],
    [/(автосервис|сто|шиномонтаж|автомойка)/i, 'Автосервисы'],
  ]
  for (const [re, label] of map) {
    if (re.test(lower)) return label
  }
  return v
}

export function resolveCategory(...candidates: Array<string | undefined | null>): string {
  for (const candidate of candidates) {
    const v = cleanupCategory(String(candidate || ''))
    if (!v || isGarbageCategory(v)) continue
    return canonicalize(v)
  }
  return FALLBACK_CATEGORY
}

function inferCategoryFromName(name: string | undefined | null): string | undefined {
  const n = String(name || '').toLowerCase()
  if (!n) return undefined
  if (/(стомат|clinic|клиник|медиц|med|dental|dent)/i.test(n)) return 'Медицина'
  if (/(университет|вуз|институт|college|school|школ)/i.test(n)) return 'Образование'
  if (/(кафе|coffee|coff|ресторан|бар|паб|bistro)/i.test(n)) return 'Рестораны и бары'
  return undefined
}

export function resolveLeadCategory(
  leadName: string | undefined | null,
  contextCategory?: string | null,
  capturedCategory?: string | null
): string {
  const byName = inferCategoryFromName(leadName)
  // Trust page-captured category first, then business-name signal, then run context.
  return resolveCategory(capturedCategory, byName, contextCategory)
}


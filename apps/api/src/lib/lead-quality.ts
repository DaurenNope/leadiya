export type LeadInput = {
  name?: string
  city?: string
  category?: string
  address?: string
  phones?: string[]
  emails?: string[]
  website?: string
  instagram?: string
  whatsapp?: string
  telegram?: string
  facebook?: string
  bin?: string
  rating?: number | null
  lat?: string
  lng?: string
  sourceUrl?: string
}

export type LeadQuality = {
  citySource: 'input' | 'address' | 'fallback'
  cityConfidence: 'high' | 'medium' | 'low'
  categorySource: 'input' | 'name_heuristic' | 'fallback'
  categoryConfidence: 'high' | 'medium' | 'low'
  flags: string[]
}

export type SanitizedLead = {
  name: string
  city: string
  category: string
  address: string
  phones: string[]
  emails: string[]
  website: string
  instagram: string
  whatsapp: string
  telegram: string
  facebook: string
  bin: string
  rating: number | null
  lat: string
  lng: string
  sourceUrl: string
  quality: LeadQuality
}

const FALLBACK_CITY = 'Не указан'
const FALLBACK_CATEGORY = 'Без категории'

const CITY_SLUG_TO_RU: Record<string, string> = {
  almaty: 'Алматы',
  astana: 'Астана',
  shymkent: 'Шымкент',
  karaganda: 'Караганда',
  aktobe: 'Актобе',
  taraz: 'Тараз',
  pavlodar: 'Павлодар',
  ust_kamenogorsk: 'Усть-Каменогорск',
  semey: 'Семей',
  atyrau: 'Атырау',
  kostanay: 'Костанай',
  kyzylorda: 'Кызылорда',
  uralsk: 'Уральск',
  petropavlovsk: 'Петропавловск',
  aktau: 'Актау',
  temirtau: 'Темиртау',
  turkestan: 'Туркестан',
  kokshetau: 'Кокшетау',
  taldykorgan: 'Талдыкорган',
  ekibastuz: 'Экибастуз',
  rudnyy: 'Рудный',
  zhanaozen: 'Жанаозен',
}

const CITY_RU_ALIASES: Record<string, string> = {
  'алматы': 'Алматы',
  'астана': 'Астана',
  'шымкент': 'Шымкент',
  'караганда': 'Караганда',
  'актобе': 'Актобе',
  'тараз': 'Тараз',
  'павлодар': 'Павлодар',
  'усть каменогорск': 'Усть-Каменогорск',
  'семей': 'Семей',
  'атырау': 'Атырау',
  'костанай': 'Костанай',
  'кызылорда': 'Кызылорда',
  'уральск': 'Уральск',
  'петропавловск': 'Петропавловск',
  'актау': 'Актау',
  'темиртау': 'Темиртау',
  'туркестан': 'Туркестан',
  'кокшетау': 'Кокшетау',
  'талдыкорган': 'Талдыкорган',
  'экибастуз': 'Экибастуз',
  'рудный': 'Рудный',
  'жанаозен': 'Жанаозен',
}

const KNOWN_CITIES = Array.from(new Set(Object.values(CITY_RU_ALIASES)))

function cleanText(raw: string | undefined | null): string {
  return String(raw || '').replace(/\s+/g, ' ').trim()
}

function normalizeToken(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
}

function cityFromInput(raw: string): string | undefined {
  if (!raw) return undefined
  const key = normalizeToken(raw)
  if (CITY_SLUG_TO_RU[key]) return CITY_SLUG_TO_RU[key]
  const ruKey = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  if (CITY_RU_ALIASES[ruKey]) return CITY_RU_ALIASES[ruKey]
  return undefined
}

function cityFromAddress(raw: string): string | undefined {
  const lower = raw.toLowerCase()
  if (!lower) return undefined
  for (const city of KNOWN_CITIES) {
    if (lower.includes(city.toLowerCase())) return city
  }
  return undefined
}

function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, '')
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

function sanitizeCategory(raw: string): string | undefined {
  const v = cleanText(raw)
  if (!v) return undefined
  if (v.length > 80) return undefined
  if (/https?:\/\//i.test(v)) return undefined
  if (/^(android|ios|app\s?store|google\s?play)$/i.test(v)) return undefined
  const lower = v.toLowerCase()
  if (/(жк|жил(ой|ые)\s+комплекс|новострой)/i.test(lower)) return 'Новостройки'
  if (/(кофе|кофейня|кафе)/i.test(lower)) return 'Кафе'
  if (/(ресторан|ресто|бар|паб)/i.test(lower)) return 'Рестораны и бары'
  if (/(стомат|клиник|медиц|больниц|dent|dental)/i.test(lower)) return 'Медицина'
  if (/(университет|вуз|институт|колледж|школ)/i.test(lower)) return 'Образование'
  if (/(автосервис|сто|шиномонтаж|автомойка)/i.test(lower)) return 'Автосервисы'
  return v
}

function categoryFromName(name: string): string | undefined {
  const n = name.toLowerCase()
  if (/(стомат|clinic|клиник|медиц|med|dental|dent)/i.test(n)) return 'Медицина'
  if (/(университет|вуз|институт|college|school|школ)/i.test(n)) return 'Образование'
  if (/(кафе|coffee|coff|ресторан|restaurant|бар|bar|паб|pub|bistro|grill)/i.test(n)) return 'Рестораны и бары'
  return undefined
}

function shouldOverrideCategoryByName(rawCategory: string | undefined, byName: string | undefined): boolean {
  if (!rawCategory || !byName) return false
  // High-confidence medical/education signals should override generic stale categories.
  if (byName === 'Медицина' || byName === 'Образование') {
    return rawCategory !== byName
  }
  // If a place clearly looks like horeca by name, override stale verticals.
  if (byName === 'Рестораны и бары' || byName === 'Кафе') {
    return rawCategory === 'Образование' || rawCategory === 'Медицина' || rawCategory === 'Без категории'
  }
  return false
}

export function sanitizeLeadPayload(input: LeadInput): SanitizedLead {
  const name = cleanText(input.name)
  const address = cleanText(input.address)
  const inputCityRaw = cleanText(input.city)
  const cityByInput = cityFromInput(inputCityRaw)
  const cityByAddress = cityFromAddress(address)
  const resolvedCity = cityByAddress || cityByInput || (inputCityRaw || FALLBACK_CITY)

  const rawCategory = sanitizeCategory(input.category || '')
  const nameCategory = categoryFromName(name)
  const overrideByName = shouldOverrideCategoryByName(rawCategory, nameCategory)
  const resolvedCategory = overrideByName
    ? (nameCategory as string)
    : rawCategory || nameCategory || FALLBACK_CATEGORY

  const flags: string[] = []
  if (!rawCategory) flags.push('fallback_category')
  if (overrideByName) flags.push('category_overridden_by_name')
  if (cityByInput && cityByAddress && cityByInput !== cityByAddress) flags.push('city_mismatch')
  if (!cityByInput && !cityByAddress) flags.push('city_unverified')

  const phones = (input.phones || []).map(normalizePhone).filter((p) => p.length >= 9)
  const emails = (input.emails || []).map(normalizeEmail).filter((e) => e.includes('@'))
  if (phones.length === 0 && emails.length === 0 && !cleanText(input.whatsapp)) {
    flags.push('no_direct_contact')
  }

  const quality: LeadQuality = {
    citySource: cityByAddress ? 'address' : cityByInput ? 'input' : 'fallback',
    cityConfidence: cityByAddress || cityByInput ? 'high' : 'low',
    categorySource: overrideByName ? 'name_heuristic' : rawCategory ? 'input' : nameCategory ? 'name_heuristic' : 'fallback',
    categoryConfidence: overrideByName ? 'high' : rawCategory ? 'high' : nameCategory ? 'medium' : 'low',
    flags,
  }

  return {
    name,
    city: resolvedCity,
    category: resolvedCategory,
    address,
    phones,
    emails,
    website: cleanText(input.website),
    instagram: cleanText(input.instagram),
    whatsapp: cleanText(input.whatsapp),
    telegram: cleanText(input.telegram),
    facebook: cleanText(input.facebook),
    bin: cleanText(input.bin),
    rating: input.rating ?? null,
    lat: cleanText(input.lat),
    lng: cleanText(input.lng),
    sourceUrl: cleanText(input.sourceUrl),
    quality,
  }
}


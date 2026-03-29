const FALLBACK_CITY = 'Не указан'

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

const KNOWN_CITIES_RU = Array.from(new Set(Object.values(CITY_RU_ALIASES)))

function normalizeToken(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_')
}

export function resolveCity(...candidates: Array<string | undefined | null>): string {
  for (const raw of candidates) {
    const value = String(raw || '').trim()
    if (!value) continue
    const key = normalizeToken(value)
    if (CITY_SLUG_TO_RU[key]) return CITY_SLUG_TO_RU[key]
    const ruKey = value.toLowerCase().replace(/\s+/g, ' ').trim()
    if (CITY_RU_ALIASES[ruKey]) return CITY_RU_ALIASES[ruKey]
    // Keep original (already human-readable city) but normalize whitespace.
    return value.replace(/\s+/g, ' ')
  }
  return FALLBACK_CITY
}

export function resolveCityFromAddress(address: string | undefined | null): string | undefined {
  const value = String(address || '').toLowerCase()
  if (!value) return undefined
  for (const city of KNOWN_CITIES_RU) {
    if (value.includes(city.toLowerCase())) return city
  }
  return undefined
}


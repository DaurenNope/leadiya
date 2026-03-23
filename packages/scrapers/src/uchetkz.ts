export interface UchetResult {
  bin: string
  nameRu: string | null
  nameKz: string | null
  legalStatus: string | null
  registrationDate: string | null
  okedCode: string | null
  okedName: string | null
  directorName: string | null
}

const UCHET_TOKEN = process.env.UCHET_API_TOKEN?.trim() || ''
const UCHET_BASE = 'https://pk.uchet.kz/api/v2'
const TIMEOUT_MS = 20_000

/**
 * Enrich a lead by BIN via pk.uchet.kz API.
 * Requires UCHET_API_TOKEN env var (get from pk.uchet.kz personal cabinet).
 * Returns null if token is missing or API is unreachable.
 */
export async function enrichFromUchet(bin: string): Promise<UchetResult | null> {
  if (!UCHET_TOKEN) {
    return null
  }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

    const url = `${UCHET_BASE}/get_bin_info/?token=${encodeURIComponent(UCHET_TOKEN)}&bin=${encodeURIComponent(bin)}`
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timer)

    if (!res.ok) {
      console.warn(`[uchet] ${bin}: HTTP ${res.status}`)
      return null
    }

    const data = (await res.json()) as Record<string, unknown>
    if (!data || data.detail) return null

    return {
      bin,
      nameRu: str(data.name_ru),
      nameKz: str(data.name_kz),
      legalStatus: str(data.status),
      registrationDate: str(data.registration_date),
      okedCode: str(data.oked_code),
      okedName: str(data.oked_name_ru),
      directorName: str(data.head_fullname),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes('abort')) console.warn(`[uchet] ${bin}: ${msg}`)
    return null
  }
}

export function isUchetAvailable(): boolean {
  return !!UCHET_TOKEN
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

export type OutreachTemplateVars = {
  calendar_url: string
  signature: string
  our_name: string
  default_first_name: string
}

const FALLBACK: OutreachTemplateVars = {
  calendar_url: 'https://cal.com/rahmetlabs/30min',
  signature: '— Команда Rahmet Labs',
  our_name: 'Rahmet Labs',
  default_first_name: 'коллега',
}

let cache: { at: number; data: OutreachTemplateVars } | null = null
const TTL_MS = 60_000

/** Reads `config/business.yml` with a short TTL cache (worker picks up edits without full restart). */
export function getOutreachTemplateDefaults(): OutreachTemplateVars {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.data

  try {
    const raw = readFileSync(join(process.cwd(), 'config', 'business.yml'), 'utf8')
    const doc = parseYaml(raw) as {
      company?: { name?: string; name_ru?: string; calendar_url?: string }
      voice?: { signature?: string }
    }
    const data: OutreachTemplateVars = {
      calendar_url: doc.company?.calendar_url?.trim() || FALLBACK.calendar_url,
      signature: doc.voice?.signature?.trim() || FALLBACK.signature,
      our_name:
        doc.company?.name?.trim() ||
        doc.company?.name_ru?.trim() ||
        FALLBACK.our_name,
      default_first_name: process.env.OUTREACH_DEFAULT_FIRST_NAME?.trim() || FALLBACK.default_first_name,
    }
    cache = { at: now, data }
    return data
  } catch {
    cache = {
      at: now,
      data: {
        ...FALLBACK,
        default_first_name: process.env.OUTREACH_DEFAULT_FIRST_NAME?.trim() || FALLBACK.default_first_name,
      },
    }
    return cache.data
  }
}

export type ReportBrand = { productName: string; botSignoff: string }

let brandCache: { at: number; data: ReportBrand } | null = null

export function getReportBrand(): ReportBrand {
  const now = Date.now()
  if (brandCache && now - brandCache.at < TTL_MS) return brandCache.data

  try {
    const raw = readFileSync(join(process.cwd(), 'config', 'business.yml'), 'utf8')
    const doc = parseYaml(raw) as {
      company?: { name?: string; name_ru?: string }
      product?: { name?: string }
    }
    const name = doc.company?.name?.trim() || doc.company?.name_ru?.trim() || 'Leadiya'
    const product = doc.product?.name?.trim() || 'Leadiya'
    brandCache = { at: now, data: { productName: product, botSignoff: `— ${name} Bot` } }
    return brandCache.data
  } catch {
    brandCache = { at: now, data: { productName: 'Leadiya', botSignoff: '— Leadiya Bot' } }
    return brandCache.data
  }
}

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

function parseDelayLike(delay: string | number | undefined, fallbackMs: number): number {
  if (delay == null) return fallbackMs
  if (typeof delay === 'number') return delay
  const m = String(delay).match(/^(\d+)(ms|s|m|h|d)$/)
  if (!m) return fallbackMs
  const v = parseInt(m[1], 10)
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return v * (units[m[2]] ?? 0) || fallbackMs
}

let automationCache: { at: number; data: { maxFollowupsPerLead: number; defaultCooldownMs: number } } | null = null

/** Limits from `config/business.yml` automation section (cached). */
export function getAutomationLimits(): { maxFollowupsPerLead: number; defaultCooldownMs: number } {
  const now = Date.now()
  if (automationCache && now - automationCache.at < TTL_MS) return automationCache.data

  try {
    const raw = readFileSync(join(process.cwd(), 'config', 'business.yml'), 'utf8')
    const doc = parseYaml(raw) as {
      automation?: { max_followups_per_lead?: number; sequence_cooldown?: string }
    }
    const max = doc.automation?.max_followups_per_lead ?? 4
    const cd = doc.automation?.sequence_cooldown ?? '30d'
    const data = {
      maxFollowupsPerLead: Math.max(1, Number(max) || 4),
      defaultCooldownMs: parseDelayLike(cd, 30 * 86_400_000),
    }
    automationCache = { at: now, data }
    return data
  } catch {
    const data = { maxFollowupsPerLead: 4, defaultCooldownMs: 30 * 86_400_000 }
    automationCache = { at: now, data }
    return data
  }
}

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

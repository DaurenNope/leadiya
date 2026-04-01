import { Redis } from 'ioredis'
import { env } from '@leadiya/config'

export type DiscoverySliceState = {
  staleRuns: number
  cooldownUntilMs: number
}

const BASE_INTERVAL_MS = 6 * 60 * 60 * 1000
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_LIST_PAGES = 8
const DEFAULT_MAX_DETAIL_ATTEMPTS = 120

let _redis: Redis | null = null

function redisClient(): Redis {
  if (!_redis) _redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true })
  return _redis
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '_')
}

export function discoverySliceKey(tenantId: string | undefined, city: string, category: string): string {
  return `${tenantId || 'default'}:${slug(city)}:${slug(category)}`
}

export function nextCooldownMs(staleRuns: number): number {
  const exponent = Math.max(0, staleRuns)
  return Math.min(BASE_INTERVAL_MS * 2 ** exponent, MAX_INTERVAL_MS)
}

export function computeAdaptiveLimits(staleRuns: number): { maxListPages: number; maxFirmDetailAttempts: number } {
  if (staleRuns >= 6) return { maxListPages: 1, maxFirmDetailAttempts: 20 }
  if (staleRuns >= 4) return { maxListPages: 2, maxFirmDetailAttempts: 40 }
  if (staleRuns >= 2) return { maxListPages: 4, maxFirmDetailAttempts: 80 }
  return { maxListPages: DEFAULT_MAX_LIST_PAGES, maxFirmDetailAttempts: DEFAULT_MAX_DETAIL_ATTEMPTS }
}

export async function loadSliceState(sliceKey: string): Promise<DiscoverySliceState> {
  const r = redisClient()
  const raw = await r.hgetall(`discovery:slice:${sliceKey}`)
  return {
    staleRuns: Number.parseInt(raw.staleRuns || '0', 10) || 0,
    cooldownUntilMs: Number.parseInt(raw.cooldownUntilMs || '0', 10) || 0,
  }
}

export async function saveSliceOutcome(sliceKey: string, newLeads: number, nowMs = Date.now()): Promise<void> {
  const r = redisClient()
  const state = await loadSliceState(sliceKey)
  const staleRuns = newLeads > 0 ? 0 : state.staleRuns + 1
  const cooldownUntilMs = nowMs + nextCooldownMs(staleRuns)
  await r.hset(`discovery:slice:${sliceKey}`, {
    staleRuns: String(staleRuns),
    cooldownUntilMs: String(cooldownUntilMs),
    lastRunAtMs: String(nowMs),
    lastNewLeads: String(newLeads),
  })
}

export async function shouldRunSlice(sliceKey: string, nowMs = Date.now()): Promise<boolean> {
  const state = await loadSliceState(sliceKey)
  return state.cooldownUntilMs <= nowMs
}

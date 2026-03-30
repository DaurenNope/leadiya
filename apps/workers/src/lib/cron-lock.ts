import { Redis } from 'ioredis'
import { env } from '@leadiya/config'

let _redis: Redis | null = null

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true })
    _redis.on('error', (err: Error) => console.error('[cron-lock] Redis error:', err.message))
  }
  return _redis
}

/**
 * Runs `fn` only if this process acquires a short-lived Redis lock.
 * Prevents duplicate cron work when multiple worker replicas run.
 */
export async function withCronLock<T>(name: string, ttlSec: number, fn: () => Promise<T>): Promise<T | undefined> {
  const key = `cron:lock:${name}`
  const token = `${process.pid}:${Date.now()}`
  const r = getRedis()
  try {
    const ok = await r.set(key, token, 'EX', ttlSec, 'NX')
    if (ok !== 'OK') {
      console.log(`[cron-lock] skip ${name} — lock held`)
      return undefined
    }
    return await fn()
  } catch (err) {
    console.error(`[cron-lock] ${name}:`, err)
    return undefined
  } finally {
    const unlock = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `
    try {
      await r.eval(unlock, 1, key, token)
    } catch {
      /* TTL will expire */
    }
  }
}

export async function disconnectCronRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit().catch(() => {})
    _redis = null
  }
}

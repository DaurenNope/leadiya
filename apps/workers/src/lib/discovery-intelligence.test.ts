import { describe, it, expect } from 'vitest'
import { computeAdaptiveLimits, nextCooldownMs, discoverySliceKey } from './discovery-intelligence.js'

describe('discovery intelligence heuristics', () => {
  it('backs off cooldown exponentially with cap', () => {
    expect(nextCooldownMs(0)).toBe(6 * 60 * 60 * 1000)
    expect(nextCooldownMs(1)).toBe(12 * 60 * 60 * 1000)
    expect(nextCooldownMs(10)).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('shrinks crawl limits as stale runs increase', () => {
    expect(computeAdaptiveLimits(0).maxListPages).toBe(8)
    expect(computeAdaptiveLimits(3).maxListPages).toBe(4)
    expect(computeAdaptiveLimits(5).maxListPages).toBe(2)
    expect(computeAdaptiveLimits(7).maxListPages).toBe(1)
  })

  it('creates stable slice keys', () => {
    expect(discoverySliceKey('t1', 'Алматы', 'Рестораны')).toBe('t1:алматы:рестораны')
  })
})

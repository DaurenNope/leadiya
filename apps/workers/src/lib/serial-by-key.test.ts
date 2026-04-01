import { describe, it, expect } from 'vitest'
import { enqueueSerialized } from './serial-by-key.js'

describe('enqueueSerialized', () => {
  it('runs tasks for same key sequentially', async () => {
    const order: string[] = []

    const a = enqueueSerialized('lead-1', async () => {
      order.push('a:start')
      await new Promise((r) => setTimeout(r, 20))
      order.push('a:end')
    })

    const b = enqueueSerialized('lead-1', async () => {
      order.push('b:start')
      order.push('b:end')
    })

    await Promise.all([a, b])
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('allows different keys to proceed independently', async () => {
    const seen = new Set<string>()
    await Promise.all([
      enqueueSerialized('lead-a', async () => { seen.add('a') }),
      enqueueSerialized('lead-b', async () => { seen.add('b') }),
    ])
    expect(seen.has('a')).toBe(true)
    expect(seen.has('b')).toBe(true)
  })
})

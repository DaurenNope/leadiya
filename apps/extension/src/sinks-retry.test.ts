import { describe, expect, it } from 'vitest'
import { maxRetriesForSink, nextBackoffMs } from '../lib/sinks/retry-policy'

describe('retry policy', () => {
  it('provides sane max retries by sink', () => {
    expect(maxRetriesForSink('api')).toBeGreaterThanOrEqual(3)
    expect(maxRetriesForSink('webhook')).toBeGreaterThanOrEqual(3)
    expect(maxRetriesForSink('sheets')).toBeGreaterThanOrEqual(3)
  })

  it('grows delay with attempts', () => {
    const first = nextBackoffMs('api', 1)
    const second = nextBackoffMs('api', 2)
    const third = nextBackoffMs('api', 3)
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
  })
})


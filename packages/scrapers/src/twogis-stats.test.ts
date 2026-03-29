import { describe, expect, it } from 'vitest'
import { normalizeSliceStats } from './twogis-stats.js'

describe('normalizeSliceStats', () => {
  it('defaults missing values to 0', () => {
    expect(normalizeSliceStats({})).toEqual({
      detailAttempts: 0,
      totalSkipped: 0,
      listPagesCompleted: 0,
      emptyPageStreakMax: 0,
    })
  })
})


export type TwogisSliceStatsInput = Partial<{
  detailAttempts: number
  totalSkipped: number
  listPagesCompleted: number
  emptyPageStreakMax: number
}>

export type TwogisSliceStats = {
  detailAttempts: number
  totalSkipped: number
  listPagesCompleted: number
  emptyPageStreakMax: number
}

function normalizeInt(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  return Math.trunc(n)
}

/** Ensure counters are always present and are valid integers (never undefined/NaN). */
export function normalizeSliceStats(input: TwogisSliceStatsInput): TwogisSliceStats {
  return {
    detailAttempts: normalizeInt(input.detailAttempts),
    totalSkipped: normalizeInt(input.totalSkipped),
    listPagesCompleted: normalizeInt(input.listPagesCompleted),
    emptyPageStreakMax: normalizeInt(input.emptyPageStreakMax),
  }
}


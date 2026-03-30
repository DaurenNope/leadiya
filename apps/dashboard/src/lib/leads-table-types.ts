export type SortKey = 'name' | 'city' | 'bin' | 'status' | 'createdAt' | 'icpScore'
export type SortOrder = 'asc' | 'desc'

export function formatAddedAt(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export type FilterBucket = { value: string; count: number }

export type FiltersMeta = {
  cities: FilterBucket[]
  categories: FilterBucket[]
  uncategorizedCount: number
  sources: FilterBucket[]
  statuses: FilterBucket[]
}

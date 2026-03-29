/** City and search category from a 2GIS URL pathname. */
export function extractContextFrom2gisUrl(rawUrl: string): { city?: string; category?: string } {
  try {
    const u = new URL(rawUrl)
    const parts = u.pathname.split('/').filter(Boolean)
    const city = parts[0] ? decodeURIComponent(parts[0]).trim() : undefined
    const searchIdx = parts.findIndex((p) => p === 'search')
    const category =
      searchIdx >= 0 && parts[searchIdx + 1]
        ? decodeURIComponent(parts[searchIdx + 1]).trim().replace(/\+/g, ' ')
        : undefined
    return { city, category }
  } catch {
    return {}
  }
}

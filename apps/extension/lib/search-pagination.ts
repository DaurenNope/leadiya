export function buildSearchPageUrl(baseUrl: string, page: number): string {
  const input = baseUrl.split('#')[0] || baseUrl
  try {
    const u = new URL(input)
    const path = u.pathname
    const basePath = path.replace(/\/page\/\d+(?=\/?$)/, '').replace(/\/$/, '')
    u.pathname = page <= 1 ? basePath : `${basePath}/page/${page}`
    return u.toString()
  } catch {
    if (page <= 1) return input.replace(/\/page\/\d+(?=\/?$)/, '')
    if (/\/page\/\d+(?=\/?$)/.test(input)) return input.replace(/\/page\/\d+(?=\/?$)/, `/page/${page}`)
    const clean = input.replace(/\/$/, '')
    return `${clean}/page/${page}`
  }
}


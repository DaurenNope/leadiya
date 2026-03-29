/** Same host as API; dashboard on 5173 when API is local (matches dev-web-stable). */
export function dashboardUrlFromApi(apiUrl: string): string {
  try {
    const u = new URL(apiUrl)
    const host = u.hostname
    if (host === 'localhost' || host === '127.0.0.1') {
      if (u.port === '3041' || u.port === '') return `${u.protocol}//${host}:5173`
    }
    return `${u.protocol}//${host}:5173`
  } catch {
    return 'http://localhost:5173'
  }
}

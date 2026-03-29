/**
 * Base URL for REST calls. Empty = same-origin (Vite dev proxy or nginx /api proxy).
 * Set at build time: VITE_PUBLIC_API_ORIGIN=https://your-api.example.com
 */
const raw = import.meta.env.VITE_PUBLIC_API_ORIGIN?.replace(/\/$/, '') ?? ''

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = `/${path}`
  return raw ? `${raw}${path}` : path
}

/** Подпись в настройках: как браузер достукивается до API. */
export function apiOriginLabel(): string {
  return raw || 'Тот же origin — `/api` проксируется на API (см. `LEADIYA_API_ORIGIN` в конфиге Vite)'
}

/** Liveness check — `/health` is unauthenticated on the API; Vite and dashboard nginx should proxy it when using same-origin. */
export function apiReachabilityUrl(): string {
  return raw ? `${raw}/health` : '/health'
}

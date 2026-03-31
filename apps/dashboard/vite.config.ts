import { readFileSync } from 'fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Monorepo root — so `LEADIYA_API_ORIGIN` can live next to `DATABASE_URL` in one `.env`. */
const repoRoot = resolve(__dirname, '../..')

type DevPorts = {
  localCliApiPort: number
  viteDevPort: number
  dockerComposeApiHostPort: number
  dockerComposeDashboardPort: number
}

function loadDevPorts(): DevPorts {
  try {
    return JSON.parse(readFileSync(join(repoRoot, 'dev-ports.json'), 'utf8')) as DevPorts
  } catch {
    return {
      localCliApiPort: 3041,
      viteDevPort: 5173,
      dockerComposeApiHostPort: 3001,
      dockerComposeDashboardPort: 8080,
    }
  }
}

const devPorts = loadDevPorts()
const defaultApiOrigin = `http://localhost:${devPorts.localCliApiPort}`

/** Use only protocol+host+port so a mistaken path in .env does not break proxy targets. */
function normalizeApiOrigin(raw: string): string {
  let s = raw.trim().replace(/\/$/, '')
  if (!s) return defaultApiOrigin
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  try {
    const u = new URL(s)
    return `${u.protocol}//${u.host}`
  } catch {
    return defaultApiOrigin
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, repoRoot, '')
  /** Must match the Hono listen URL or the browser gets 502 from the dev proxy. See repo-root `.env.example` (PORT / LEADIYA_API_ORIGIN). */
  const apiOrigin = normalizeApiOrigin(
    rootEnv.LEADIYA_API_ORIGIN || process.env.LEADIYA_API_ORIGIN || defaultApiOrigin,
  )

  if (mode === 'development') {
    console.info(`[dashboard/vite] proxy /api and /health → ${apiOrigin}`)
    if (apiOrigin.includes('://localhost:5173') || apiOrigin.includes('://127.0.0.1:5173')) {
      console.warn(
        `[dashboard/vite] LEADIYA_API_ORIGIN points at Vite’s port (${devPorts.viteDevPort}). Use the Hono API port (see dev-ports.json → localCliApiPort).`,
      )
    }
  }

  const apiProxy = {
    '/api': { target: apiOrigin, changeOrigin: true },
    '/health': { target: apiOrigin, changeOrigin: true },
  } as const

  return {
    /** Monorepo: env lives in repo-root `.env` (same as API). Default `envDir` is `apps/dashboard`, so `VITE_*` was never loaded → blank Supabase client in the browser. */
    envDir: repoRoot,
    define: {
      /** Dev-only: actual proxy target (may differ from default if .env overrides). */
      __LEADIYA_DEV_PROXY_TARGET__: JSON.stringify(mode === 'development' ? apiOrigin : ''),
      /** From dev-ports.json — fallback copy in UI when dev proxy target is empty. */
      __LEADIYA_DEFAULT_API_ORIGIN__: JSON.stringify(defaultApiOrigin),
    },
    plugins: [react(), tailwindcss()],
    server: {
      /** Bind IPv4 + LAN; default `localhost` on some macOS/Node stacks is IPv6-only, so `127.0.0.1:5173` would refuse connections. */
      host: true,
      port: devPorts.viteDevPort,
      strictPort: false,
      proxy: { ...apiProxy },
    },
    preview: {
      proxy: { ...apiProxy },
    },
  }
})

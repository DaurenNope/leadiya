# Ports (canonical)

**Source of truth:** repo-root [`dev-ports.json`](../dev-ports.json).

| Key | Meaning |
|-----|--------|
| `localCliApiPort` | `npm run dev:api` / `dev:api-only` when `PORT` is unset. Vite’s default `LEADIYA_API_ORIGIN` uses this. |
| `viteDevPort` | Preferred Vite dev server port (`apps/dashboard` `vite.config.ts`). |
| `dockerComposeApiHostPort` | Host port published for the `api` service (`docker-compose.yml`). |
| `dockerComposeDashboardPort` | Host port for the static dashboard nginx service. |

**Docker:** the API container still listens on **3001** inside the image (`Dockerfile` `ENV PORT=3001`); Compose maps **host `dockerComposeApiHostPort` → container 3001**. Your `.env` may say `PORT=3041` for local CLI; Compose overrides with `environment: PORT: "3001"` so the container stays consistent.

**After changing `dev-ports.json`:** update `.env.example` if you change the default port, run dashboard + API builds, and reload the Chrome extension build (it imports the JSON).

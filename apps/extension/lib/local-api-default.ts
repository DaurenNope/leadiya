import devPorts from '../../../dev-ports.json' with { type: 'json' }

/** Same default as dashboard Vite proxy + `npm run dev:api` (repo-root dev-ports.json). */
export const DEFAULT_LOCAL_API_ORIGIN = `http://localhost:${devPorts.localCliApiPort}` as const

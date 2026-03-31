/**
 * Application entrypoint — binds HTTP. Import `./server.js` for tests (app only, no listen).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { app } from './server.js'

function defaultLocalApiPort(): number {
  try {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
    const raw = readFileSync(join(repoRoot, 'dev-ports.json'), 'utf8')
    const j = JSON.parse(raw) as { localCliApiPort?: number }
    return typeof j.localCliApiPort === 'number' ? j.localCliApiPort : 3041
  } catch {
    return 3041
  }
}

const port = parseInt(process.env.PORT || String(defaultLocalApiPort()), 10)
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`API server running at http://localhost:${port}`)
})
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[api] Port ${port} is already in use (another API or stale process). Stop it: lsof -i :${port} or use PORT=3042`,
    )
  } else {
    console.error('[api] HTTP server error:', err)
  }
  process.exit(1)
})
const shutdown = () => {
  server.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

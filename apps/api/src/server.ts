import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { env } from '@leadiya/config'
import { authMiddleware } from './middleware/auth.js'
import { companiesRouter } from './routes/companies.js'
import { scrapersRouter } from './routes/scrapers.js'
import { stripeRouter } from './routes/stripe.js'
import { leadsRouter } from './routes/leads.js'
import { outreachRouter } from './routes/outreach.js'
import { systemRouter } from './routes/system.js'

export type AppEnv = {
  Variables: {
    user: any
    tenant: any
  }
}

const app = new Hono<AppEnv>()
export { app }

app.use('*', cors())

app.onError((err, c) => {
  const status = (err as any).status || 500
  const code = (err as any).code || 'INTERNAL_ERROR'
  console.error(`API_ERROR [${c.req.method} ${c.req.path}]:`, err.message)
  return c.json(
    {
      error: err.message,
      code,
      ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
    },
    status
  )
})

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    /** Lets devs spot another process accidentally bound to PORT (e.g. plain-text 404 on /api/*). */
    service: 'leadiya-api',
    env: env.NODE_ENV,
    /** Hermes/agent HTTP tools: set LEADIYA_AGENT_SERVICE_KEY on API + send X-Leadiya-Service-Key */
    agentBridgeConfigured: Boolean(env.LEADIYA_AGENT_SERVICE_KEY?.trim()),
  }),
)

app.use('/api/*', authMiddleware)

app.route('/api/companies', companiesRouter)
app.route('/api/scrapers', scrapersRouter)
app.route('/api/stripe', stripeRouter)
app.route('/api/leads', leadsRouter)
app.route('/api/outreach', outreachRouter)
app.route('/api/system', systemRouter)

/** Default port comes from repo-root `dev-ports.json` (single source of truth with Vite + docs). Docker image sets PORT=3001. */
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
serve({ fetch: app.fetch, port })
console.log(`API server running at http://localhost:${port}`)

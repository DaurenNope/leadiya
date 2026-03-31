import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from '@leadiya/config'
import { authMiddleware } from './middleware/auth.js'
import { tenantMiddleware } from './middleware/tenant.js'
import { companiesRouter } from './routes/companies.js'
import { scrapersRouter } from './routes/scrapers.js'
import { stripeRouter } from './routes/stripe.js'
import { leadsRouter } from './routes/leads.js'
import { outreachRouter } from './routes/outreach.js'
import { systemRouter } from './routes/system.js'
import { settingsRouter } from './routes/settings.js'
import { tenantsRouter } from './routes/tenants.js'
import { crmRouter } from './routes/crm.js'
import type { AppEnv } from './types.js'

const app = new Hono<AppEnv>()
export { app }

/** Dev: Vite may use 5174+ if 5173 is busy; allow any localhost port. */
function isDevLocalDashboardOrigin(origin: string): boolean {
  if (env.NODE_ENV !== 'development') return false
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return origin
    const allowed = [
      env.DASHBOARD_URL,
      /** Production dashboard (Rahmet Labs). Override via `DASHBOARD_URL` if you use another host. */
      'https://app.rahmetlabs.com',
      'http://localhost:5173',
      'http://localhost:4173',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:4173',
    ].filter(Boolean)
    if (allowed.includes(origin)) return origin
    if (isDevLocalDashboardOrigin(origin)) return origin
    return null
  },
  credentials: true,
}))

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
app.use('/api/*', tenantMiddleware)

app.route('/api/tenants', tenantsRouter)
app.route('/api/crm', crmRouter)
app.route('/api/companies', companiesRouter)
app.route('/api/scrapers', scrapersRouter)
app.route('/api/stripe', stripeRouter)
app.route('/api/leads', leadsRouter)
app.route('/api/outreach', outreachRouter)
app.route('/api/system', systemRouter)
app.route('/api/settings', settingsRouter)

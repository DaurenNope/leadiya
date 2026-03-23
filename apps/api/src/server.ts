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

app.get('/health', (c) => c.json({ status: 'ok', env: env.NODE_ENV }))

app.use('/api/*', authMiddleware)

app.route('/api/companies', companiesRouter)
app.route('/api/scrapers', scrapersRouter)
app.route('/api/stripe', stripeRouter)
app.route('/api/leads', leadsRouter)
app.route('/api/outreach', outreachRouter)

const port = parseInt(process.env.PORT || '3001', 10)
serve({ fetch: app.fetch, port })
console.log(`API server running at http://localhost:${port}`)

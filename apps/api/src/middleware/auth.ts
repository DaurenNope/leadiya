import { createClient } from '@supabase/supabase-js'
import * as jose from 'jose'
import { env } from '@leadiya/config'
import type { MiddlewareHandler } from 'hono'

const supabase =
  env.SUPABASE_URL && env.SUPABASE_ANON_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)
    : null

type AuthUser = { id: string; email?: string | null }

/**
 * Prefer local JWT verification when SUPABASE_JWT_SECRET is set — zero HTTP calls to Supabase Auth
 * (saves egress). Falls back to supabase.auth.getUser(token) otherwise.
 */
async function resolveUserFromBearerToken(token: string): Promise<AuthUser | null> {
  if (env.SUPABASE_JWT_SECRET) {
    try {
      const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
      const issuer =
        env.SUPABASE_URL != null
          ? `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`
          : undefined
      const { payload } = await jose.jwtVerify(token, secret, {
        algorithms: ['HS256'],
        ...(issuer ? { issuer } : {}),
      })
      const sub = typeof payload.sub === 'string' ? payload.sub : null
      if (!sub) return null
      const email = typeof payload.email === 'string' ? payload.email : null
      return { id: sub, email }
    } catch {
      return null
    }
  }

  if (!supabase) return null
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return { id: user.id, email: user.email ?? null }
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  if (env.AUTH_BYPASS === 'true') {
    c.set('user', { id: 'dev', email: 'dev@localhost' })
    return next()
  }

  if (!env.SUPABASE_JWT_SECRET && !supabase) {
    return c.json({ error: 'Auth not configured', code: 'AUTH_NOT_CONFIGURED' }, 500)
  }

  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header', code: 'UNAUTHORIZED' }, 401)
  }

  const token = authHeader.slice(7)
  const user = await resolveUserFromBearerToken(token)

  if (!user) {
    return c.json({ error: 'Invalid token', code: 'UNAUTHORIZED' }, 401)
  }

  c.set('user', user)
  return next()
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

/** Both must be set in repo-root `.env` (`vite.config.ts` sets `envDir` to the monorepo root so `VITE_*` is visible here). */
export const isSupabaseConfigured = Boolean(url && key)

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the repo-root .env (see .env.example). The login screen will load; auth stays off until then.',
  )
}

/**
 * Supabase client. When env is missing, uses a placeholder URL/key so `createClient` does not throw
 * on import (that used to crash the whole app with a blank page). Call sites must check
 * `isSupabaseConfigured` before relying on auth/network.
 */
export const supabase: SupabaseClient = createClient(
  url || 'https://supabase-env-missing.invalid',
  key || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.env-missing',
  {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'leadiya-auth',
    },
  },
)

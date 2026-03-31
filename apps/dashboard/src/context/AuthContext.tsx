import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (email: string, password: string) => Promise<string | null>
  /** Opens Google OAuth; on success the browser redirects away and returns with a session. */
  signInWithGoogle: () => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

function formatOAuthError(err: { message?: string } | null): string | null {
  const m = err?.message ?? ''
  if (!m) return null
  if (/provider is not enabled|Unsupported provider/i.test(m)) {
    return (
      'Google не включён в Supabase: Authentication → Providers → Google — включите провайдер и укажите Client ID и Secret из Google Cloud Console ' +
      '(redirect URI там: https://<ваш-проект>.supabase.co/auth/v1/callback).'
    )
  }
  return m
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) return

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    if (!isSupabaseConfigured) {
      return 'Задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в корневом .env (см. .env.example).'
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error?.message ?? null
  }, [])

  const signUp = useCallback(async (email: string, password: string): Promise<string | null> => {
    if (!isSupabaseConfigured) {
      return 'Задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в корневом .env (см. .env.example).'
    }
    const { error } = await supabase.auth.signUp({ email, password })
    return error?.message ?? null
  }, [])

  const signInWithGoogle = useCallback(async (): Promise<string | null> => {
    if (!isSupabaseConfigured) {
      return 'Задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в корневом .env (см. .env.example).'
    }
    const redirectTo = `${window.location.origin}${window.location.pathname || '/'}`
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    return formatOAuthError(error)
  }, [])

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return
    await supabase.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook paired with AuthProvider
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

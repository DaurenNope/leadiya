import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabase'

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

export function AuthPage() {
  const { signIn, signUp, signInWithGoogle } = useAuth()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [oauthBusy, setOauthBusy] = useState(false)

  const handleGoogle = async () => {
    setError(null)
    setSuccess(null)
    setOauthBusy(true)
    const err = await signInWithGoogle()
    if (err) setError(err)
    setOauthBusy(false)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setSubmitting(true)

    if (mode === 'login') {
      const err = await signIn(email, password)
      if (err) setError(err)
    } else {
      const err = await signUp(email, password)
      if (err) {
        setError(err)
      } else {
        setSuccess(
          'Почти готово — откройте письмо и подтвердите email. После этого можно войти.',
        )
      }
    }

    setSubmitting(false)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-[#020617] bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(14,165,233,0.12),transparent_50%)]">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-8">
          <div className="w-[4.5rem] h-[4.5rem] rounded-3xl flex items-center justify-center font-bold text-2xl text-[#020617] shadow-lg shadow-sky-500/25 mx-auto mb-5 bg-gradient-to-br from-sky-400 to-cyan-600 ring-1 ring-white/10">
            L
          </div>
          <h1 className="text-3xl font-bold text-slate-100 tracking-tight">Leadiya</h1>
          <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto leading-relaxed">
            Войдите, чтобы работать с лидами, CRM и рассылками
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-xl p-8 shadow-2xl shadow-black/40">
          {!isSupabaseConfigured && (
            <div className="mb-6 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/95 leading-relaxed">
              В корневом <code className="text-amber-200/90">.env</code> задайте{' '}
              <code className="text-amber-200/90">VITE_SUPABASE_URL</code> и{' '}
              <code className="text-amber-200/90">VITE_SUPABASE_ANON_KEY</code> (см.{' '}
              <code className="text-amber-200/90">.env.example</code>
              ), затем перезапустите <code className="text-amber-200/90">npm run dev:web</code>.
            </div>
          )}

          {isSupabaseConfigured && (
            <>
              <button
                type="button"
                onClick={() => void handleGoogle()}
                disabled={oauthBusy || submitting}
                className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl bg-white text-slate-800 font-semibold text-sm shadow-lg shadow-black/20 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-slate-200/80"
              >
                {oauthBusy ? (
                  <span className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <GoogleMark className="w-5 h-5 shrink-0" />
                )}
                {oauthBusy ? 'Переход к Google…' : 'Продолжить с Google'}
              </button>

              <div className="relative my-8">
                <div className="absolute inset-0 flex items-center" aria-hidden>
                  <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-wider">
                  <span className="px-3 bg-slate-900/60 text-slate-500">или почта</span>
                </div>
              </div>
            </>
          )}

          <div className="flex gap-1 mb-6 bg-slate-800/50 rounded-xl p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login')
                setError(null)
                setSuccess(null)
              }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                mode === 'login'
                  ? 'bg-gradient-to-r from-sky-500 to-cyan-500 text-[#020617] shadow-lg shadow-sky-500/25'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Вход
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup')
                setError(null)
                setSuccess(null)
              }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                mode === 'signup'
                  ? 'bg-gradient-to-r from-sky-500 to-cyan-500 text-[#020617] shadow-lg shadow-sky-500/25'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Регистрация
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required={isSupabaseConfigured}
                disabled={!isSupabaseConfigured}
                autoComplete="email"
                className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-white/10 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/25 transition-all text-sm disabled:opacity-50"
                placeholder="name@company.kz"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={isSupabaseConfigured}
                disabled={!isSupabaseConfigured}
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-white/10 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/25 transition-all text-sm disabled:opacity-50"
                placeholder="Минимум 6 символов"
              />
            </div>

            {error && (
              <div className="px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-sm leading-relaxed">
                {error}
              </div>
            )}

            {success && (
              <div className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-sm leading-relaxed">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || oauthBusy || !isSupabaseConfigured}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400 text-[#020617] font-bold text-sm shadow-xl shadow-sky-500/20 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting
                ? 'Подождите…'
                : mode === 'login'
                  ? 'Войти по паролю'
                  : 'Создать аккаунт'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-600 mt-8">
          Leadiya &copy; {new Date().getFullYear()} &middot; Rahmet Labs
        </p>
      </div>
    </div>
  )
}

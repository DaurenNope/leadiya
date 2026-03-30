import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'

export function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
        setSuccess('Аккаунт создан! Проверьте почту для подтверждения.')
      }
    }

    setSubmitting(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#020617] bg-[radial-gradient(ellipse_100%_60%_at_50%_-10%,rgba(14,165,233,0.07),transparent_55%)]">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-10">
          <div className="w-16 h-16 rounded-3xl flex items-center justify-center font-bold text-2xl text-[#020617] shadow-lg shadow-sky-500/20 mx-auto mb-6 bg-gradient-to-br from-sky-400 to-cyan-600">
            L
          </div>
          <h1 className="text-3xl font-bold text-slate-100 tracking-tight">Leadiya</h1>
          <p className="text-sm text-slate-500 mt-2">B2B лиды и автоматические рассылки для Казахстана</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/50 backdrop-blur-xl p-8">
          <div className="flex gap-1 mb-8 bg-slate-800/50 rounded-xl p-1">
            <button
              onClick={() => { setMode('login'); setError(null); setSuccess(null) }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                mode === 'login'
                  ? 'bg-gradient-to-r from-sky-500 to-cyan-500 text-[#020617] shadow-lg shadow-sky-500/25'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Вход
            </button>
            <button
              onClick={() => { setMode('signup'); setError(null); setSuccess(null) }}
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
                required
                autoComplete="email"
                className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-white/10 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/25 transition-all text-sm"
                placeholder="name@company.kz"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="w-full px-4 py-3 rounded-xl bg-slate-800/50 border border-white/10 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/25 transition-all text-sm"
                placeholder="Минимум 6 символов"
              />
            </div>

            {error && (
              <div className="px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-400 text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-sm">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400 text-[#020617] font-bold text-sm shadow-xl shadow-sky-500/25 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting
                ? 'Загрузка...'
                : mode === 'login'
                  ? 'Войти'
                  : 'Создать аккаунт'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          Leadiya &copy; {new Date().getFullYear()} &middot; Rahmet Labs
        </p>
      </div>
    </div>
  )
}

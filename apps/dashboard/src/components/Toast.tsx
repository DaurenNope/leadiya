import { useCallback, useState } from 'react'
import { ToastCtx } from '../hooks/useToast'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  type: ToastType
}

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId++
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto pl-4 pr-5 py-3 rounded-2xl text-xs font-bold shadow-2xl border backdrop-blur-xl animate-slide-up border-l-[3px] ${
              t.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 border-l-emerald-400/80 text-emerald-300'
                : t.type === 'error'
                  ? 'bg-rose-500/10 border-rose-500/20 border-l-rose-400/80 text-rose-300'
                  : 'bg-slate-900/95 border-white/10 border-l-sky-400/70 text-slate-200'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

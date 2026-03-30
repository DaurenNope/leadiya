import { useEffect, useState, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { apiUrl, authFetch } from '../apiBase'

type WaStatus = {
  status: 'unknown' | 'disconnected' | 'waiting_qr' | 'connected'
  updatedAt: number | null
  qr: string | null
  baileysSendEnabled: boolean
}

export function WhatsAppConnectPanel({ compact = false }: { compact?: boolean }) {
  const [wa, setWa] = useState<WaStatus | null>(null)
  const [error, setError] = useState(false)

  const fetchStatus = useCallback(() => {
    authFetch(apiUrl('/api/outreach/whatsapp/status'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WaStatus | null) => {
        if (d) { setWa(d); setError(false) }
      })
      .catch(() => setError(true))
  }, [])

  useEffect(() => {
    fetchStatus()
    const intervalMs = wa?.status === 'connected' ? 15_000 : 3_000
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      fetchStatus()
    }, intervalMs)
    return () => clearInterval(id)
  }, [fetchStatus, wa?.status])

  if (compact) {
    const dot = wa?.status === 'connected'
      ? 'bg-emerald-400'
      : wa?.status === 'waiting_qr'
      ? 'bg-amber-400 animate-pulse'
      : 'bg-slate-500'
    return (
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-4 py-3 text-xs text-slate-400 leading-relaxed flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        <span>
          <strong className="text-emerald-200">WhatsApp</strong>{' — '}
          {wa?.status === 'connected' && <span className="text-emerald-300">подключён</span>}
          {wa?.status === 'waiting_qr' && <span className="text-amber-300">ожидает сканирования QR</span>}
          {wa?.status === 'disconnected' && <span className="text-red-300">отключён</span>}
          {(!wa || wa.status === 'unknown') && <span>проверка…</span>}
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/25 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-emerald-100">WhatsApp подключение</h3>

      {error && (
        <p className="text-xs text-red-400">Не удалось получить статус — убедитесь, что API запущен.</p>
      )}

      {wa?.baileysSendEnabled === false && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-3 text-xs text-amber-100/90 space-y-2">
          <p className="font-semibold text-amber-100">Baileys не включён</p>
          <ol className="list-decimal list-inside space-y-1 text-amber-100/80">
            <li>Установите <code className="text-amber-200/90">WHATSAPP_BAILEYS_ENABLED=true</code> в <code>.env</code></li>
            <li>Перезапустите API и воркеры</li>
          </ol>
        </div>
      )}

      {wa?.baileysSendEnabled && (
        <>
          {wa.status === 'connected' && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-lg shadow-emerald-500/40" />
              <div>
                <p className="text-sm font-medium text-emerald-300">Сессия активна</p>
                <p className="text-[11px] text-emerald-200/70 mt-0.5">WhatsApp подключён, отправка сообщений через API работает.</p>
              </div>
            </div>
          )}

          {wa.status === 'waiting_qr' && wa.qr && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Откройте <strong className="text-white">WhatsApp</strong> → <strong className="text-white">Связанные устройства</strong> → <strong className="text-white">Привязать устройство</strong>, и отсканируйте QR:
              </p>
              <div className="flex justify-center">
                <div className="bg-white p-3 rounded-xl inline-block">
                  <QRCodeSVG value={wa.qr} size={220} level="M" />
                </div>
              </div>
              <p className="text-[10px] text-center text-slate-600">QR обновляется каждые ~20 сек. Страница опрашивает автоматически.</p>
            </div>
          )}

          {wa.status === 'waiting_qr' && !wa.qr && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 px-4 py-3 text-xs text-amber-200/80">
              <p className="animate-pulse">Генерация QR-кода…</p>
            </div>
          )}

          {wa.status === 'disconnected' && (
            <div className="rounded-xl border border-red-500/25 bg-red-950/20 px-4 py-3 text-xs text-red-200/90 space-y-1">
              <p className="font-semibold text-red-200">Отключён</p>
              <p>Воркер пытается переподключиться. Если QR не появится — перезапустите <code className="text-red-300/80">apps/workers</code>.</p>
            </div>
          )}

          {(wa.status === 'unknown' || !wa.status) && (
            <div className="rounded-xl border border-slate-500/20 bg-slate-950/30 px-4 py-3 text-xs text-slate-500">
              <p>Запустите воркеры (<code className="text-slate-400">apps/workers</code>), чтобы начать подключение.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

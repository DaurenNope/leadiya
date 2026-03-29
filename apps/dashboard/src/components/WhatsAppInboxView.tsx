import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from '../apiBase'
import { WhatsAppConnectPanel } from './WhatsAppConnectPanel'

type WaLogRow = {
  id: string
  leadId: string | null
  channel: string
  direction: string
  body: string | null
  status: string | null
  createdAt: string
  waPeer?: string | null
  leadName?: string | null
  leadCity?: string | null
}

type Props = {
  onWorkLead: (leadId: string) => void
  onBrowseLeads: () => void
  /** Открыть CRM (список слева + карточка) без привязки к лиду из ленты */
  onOpenCrm?: () => void
}

function formatTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function WhatsAppInboxView({ onWorkLead, onBrowseLeads, onOpenCrm }: Props) {
  const [items, setItems] = useState<WaLogRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) setLoading(true)
    try {
      const res = await fetch(apiUrl('/api/outreach/log?channel=whatsapp&limit=150'))
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        setItems([])
        setWarning(null)
        return
      }
      setError(null)
      const data = (await res.json()) as { items?: WaLogRow[]; warning?: string }
      setItems(data.items ?? [])
      setWarning(typeof data.warning === 'string' ? data.warning : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить')
      setItems([])
      setWarning(null)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void load({ silent: true })
    }, 12_000)
    return () => window.clearInterval(id)
  }, [load])

  return (
    <div className="animate-fade-in max-w-6xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">WhatsApp</p>
          <h2 className="text-xl font-semibold text-slate-100 tracking-tight mt-0.5">Лента диалогов</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-xl">
            Исходящие и входящие из журнала. Откройте клиента в CRM для ответа по шаблону.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load({ silent: false })}
            className="rounded-xl border border-white/[0.1] bg-slate-900/60 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/[0.04]"
          >
            Обновить
          </button>
          {onOpenCrm ? (
            <button
              type="button"
              onClick={onOpenCrm}
              className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-200 hover:bg-sky-500/15"
            >
              Панель CRM
            </button>
          ) : null}
          <button
            type="button"
            onClick={onBrowseLeads}
            className="rounded-xl border border-white/[0.1] px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200"
          >
            Таблица лидов
          </button>
        </div>
      </div>

      <WhatsAppConnectPanel />

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      {warning ? (
        <p className="text-sm text-amber-400/90 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3" role="status">
          {warning}
        </p>
      ) : null}

      <div className="rounded-2xl border border-white/[0.08] bg-slate-950/50 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col min-h-[min(65vh,560px)]">
        <div className="px-5 py-3 border-b border-white/[0.06] bg-[#070b14]/90 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#25D366]/15 text-[#25D366]">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
            </svg>
          </span>
          <span className="text-sm font-medium text-slate-300">Активность</span>
          <span className="text-xs text-slate-600 ml-auto tabular-nums">{items.length} записей</span>
        </div>

        <div className="flex-1 overflow-y-auto bg-gradient-to-b from-[#0c1220] to-[#080c14] px-4 py-4 sm:px-6">
          {loading ? (
            <p className="py-16 text-center text-sm text-slate-500">Загрузка…</p>
          ) : items.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
              Пока пусто. Отправьте сообщение из CRM — строки появятся здесь. С Baileys и входящими включите{' '}
              <code className="text-slate-400">WHATSAPP_INBOUND_LOG</code>.
            </p>
          ) : (
            <ul className="space-y-6 max-w-3xl mx-auto">
              {items.map((row) => {
                const inbound = row.direction === 'inbound'
                const title =
                  row.leadName || (row.waPeer ? 'WhatsApp' : 'Без привязки к лиду')
                return (
                  <li key={row.id} className="flex flex-col gap-1">
                    <div
                      className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}
                    >
                      <div
                        className={`max-w-[min(100%,28rem)] rounded-2xl px-4 py-3 shadow-lg ${
                          inbound
                            ? 'rounded-tl-md bg-slate-800/90 border border-white/[0.08] text-slate-200'
                            : 'rounded-tr-md bg-emerald-950/80 border border-emerald-500/25 text-emerald-50'
                        }`}
                      >
                        {row.body ? (
                          <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{row.body}</p>
                        ) : (
                          <p className="text-sm text-slate-500 italic">Без текста</p>
                        )}
                      </div>
                    </div>
                    <div
                      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 px-1 ${
                        inbound ? 'justify-start' : 'justify-end'
                      }`}
                    >
                      <span className={inbound ? 'text-sky-400/90' : 'text-emerald-400/90'}>
                        {inbound ? 'Входящее' : 'Исходящее'}
                      </span>
                      <span>·</span>
                      <span>{row.status || '—'}</span>
                      <span>·</span>
                      <span className="tabular-nums">{formatTime(row.createdAt)}</span>
                    </div>
                    <div
                      className={`flex flex-wrap items-center gap-2 text-xs ${inbound ? '' : 'justify-end'}`}
                    >
                      <span className="text-slate-400 font-medium">{title}</span>
                      {row.leadCity ? <span className="text-slate-600">· {row.leadCity}</span> : null}
                      {row.waPeer && !row.leadName ? (
                        <span className="font-mono text-[10px] text-slate-600 truncate max-w-full" title={row.waPeer}>
                          {row.waPeer}
                        </span>
                      ) : null}
                      {row.leadId ? (
                        <button
                          type="button"
                          onClick={() => onWorkLead(row.leadId!)}
                          className="rounded-lg bg-sky-600/90 px-3 py-1 text-[11px] font-semibold text-white hover:bg-sky-500"
                        >
                          Открыть в CRM
                        </button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

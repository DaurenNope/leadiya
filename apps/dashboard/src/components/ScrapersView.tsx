import { useCallback, useEffect, useState } from 'react'
import { apiUrl, authFetch } from '../apiBase'
import { useToast } from '../hooks/useToast'
import type { ScraperRunRow } from './ScraperRunBanner'

function formatWhen(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU')
}

function runStatusLabelRu(status: string) {
  const s = status.toLowerCase()
  if (s === 'running') return 'выполняется'
  if (s === 'done' || s === 'completed') return 'готово'
  if (s === 'error' || s === 'failed') return 'ошибка'
  if (s === 'cancelled') return 'остановлен'
  return status
}

function statusChip(status: string) {
  const s = status.toLowerCase()
  if (s === 'running') return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
  if (s === 'done' || s === 'completed') return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
  if (s === 'cancelled') return 'bg-slate-500/15 text-slate-300 border-slate-500/30'
  return 'bg-rose-500/15 text-rose-200 border-rose-500/30'
}

type Props = {
  onOpenDiscovery: () => void
  onWatchRun: (runId: string) => void
  /** WhatsApp / outreach UI lives on Lead list — use this to switch there from scraper screens. */
  onOpenLeadList: () => void
}

export function ScrapersView({ onOpenDiscovery, onWatchRun, onOpenLeadList }: Props) {
  const { toast } = useToast()
  const [runs, setRuns] = useState<ScraperRunRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [stopId, setStopId] = useState<string | null>(null)

  const cancelRun = async (id: string) => {
    setStopId(id)
    try {
      const res = await authFetch(apiUrl(`/api/scrapers/runs/${id}/cancel`), { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.status === 409) {
        toast(data.error || 'Запуск не выполняется', 'info')
        void load({ bustCache: true })
        return
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      toast('Запуск помечен остановленным — скрапер завершит текущий срез', 'success')
      void load({ bustCache: true })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Остановка не удалась', 'error')
    } finally {
      setStopId(null)
    }
  }

  const load = useCallback(async (opts?: { bustCache?: boolean }) => {
    try {
      const q = new URLSearchParams({ limit: '40', scraper: '2gis' })
      if (opts?.bustCache) q.set('nocache', '1')
      const res = await authFetch(apiUrl(`/api/scrapers/runs?${q.toString()}`))
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        return
      }
      setError(null)
      const data = (await res.json()) as { runs?: ScraperRunRow[] }
      setRuns(data.runs ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load({ bustCache: true })
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 8000)
    return () => window.clearInterval(id)
  }, [load])

  const running = runs.filter((r) => r.status.toLowerCase() === 'running')

  return (
    <div className="animate-fade-in max-w-5xl space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100 tracking-tight">Скраперы 2GIS</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-xl">
            Задачи идут на API с Playwright. Таблица обновляется ~каждые 8 с при видимой вкладке. <strong className="text-slate-400">Записи</strong> в БД
            появляются после сохранения лида — счётчики могут немного отставать. <strong className="text-slate-400">Остановить</strong>{' '}
            помечает строку в Postgres и просит скрапер выйти после текущего среза. <strong className="text-slate-400">Следить</strong> закрепляет живой баннер{' '}
            <strong className="text-slate-300">вверху основной области</strong> и прокручивает к нему.
          </p>
          <p className="text-sm text-emerald-200/85 mt-3 max-w-xl border border-emerald-500/20 rounded-xl bg-emerald-950/25 px-4 py-3">
            <strong className="text-emerald-100">Рассылки</strong> — в боковой панели <strong className="text-emerald-50">Работа с лидами → CRM</strong> и{' '}
            <strong className="text-emerald-50">WhatsApp</strong> (и боковая панель лида из списка). Эта страница только про задачи скрапера.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenLeadList}
            className="px-4 py-2.5 rounded-xl border border-emerald-500/35 bg-emerald-950/40 text-sm font-semibold text-emerald-100 hover:bg-emerald-900/50"
            title="Список компаний"
          >
            Список лидов
          </button>
          <button
            type="button"
            onClick={() => void load({ bustCache: true })}
            className="px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-slate-300 hover:bg-white/5"
          >
            Обновить сейчас
          </button>
          <button
            type="button"
            onClick={onOpenDiscovery}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 shadow-lg shadow-emerald-900/30"
          >
            Новая задача 2GIS
          </button>
        </div>
      </div>

      {running.length > 0 && (
        <div className="crm-panel rounded-2xl border border-amber-500/25 bg-amber-950/20 p-5 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <h3 className="text-sm font-semibold text-amber-100">Активные запуски</h3>
            <button
              type="button"
              onClick={onOpenLeadList}
              className="shrink-0 text-left text-xs font-semibold text-emerald-300 hover:text-emerald-200 underline underline-offset-2 sm:text-right"
            >
              WhatsApp и CRM → откройте список лидов и строку
            </button>
          </div>
          <ul className="space-y-2">
            {running.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-slate-300 font-mono text-xs">{r.id.slice(0, 8)}…</span>
                <span className="text-slate-400">
                  Старт {formatWhen(r.startedAt)} · <span className="text-white font-medium tabular-nums">{r.resultsCount ?? 0}</span> записей
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={stopId === r.id}
                    onClick={() => void cancelRun(r.id)}
                    className="text-xs font-semibold text-rose-300 hover:text-rose-200 underline underline-offset-2 disabled:opacity-50"
                  >
                    {stopId === r.id ? 'Остановка…' : 'Остановить'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onWatchRun(r.id)}
                    title="Закрепить баннер прогресса сверху и прокрутить"
                    className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline underline-offset-2"
                  >
                    Следить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="crm-panel rounded-2xl border border-white/[0.08] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200">Последние запуски</h3>
          {loading && <span className="text-xs text-slate-500">Загрузка…</span>}
        </div>
        {error && <p className="px-5 py-3 text-sm text-rose-400">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-white/[0.06] text-xs uppercase tracking-wide">
                <th className="px-5 py-3 font-medium">Старт</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Записей</th>
                <th className="px-5 py-3 font-medium">Завершено</th>
                <th className="px-5 py-3 font-medium">Ошибка</th>
                <th className="px-5 py-3 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {runs.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                    Запусков скрапера пока нет.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 py-3 text-slate-400 whitespace-nowrap">{formatWhen(r.startedAt)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-md border text-xs font-semibold ${statusChip(r.status)}`}>
                        {runStatusLabelRu(r.status)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-200 font-mono tabular-nums">{r.resultsCount != null ? r.resultsCount : '—'}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs whitespace-nowrap">{formatWhen(r.completedAt)}</td>
                    <td className="px-5 py-3 text-rose-300/90 text-xs max-w-[200px] truncate" title={r.error ?? undefined}>
                      {r.error ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {r.status.toLowerCase() === 'running' ? (
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            disabled={stopId === r.id}
                            onClick={() => void cancelRun(r.id)}
                            className="text-xs font-semibold text-rose-400 hover:text-rose-300 disabled:opacity-50"
                          >
                            {stopId === r.id ? 'Стоп…' : 'Стоп'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onWatchRun(r.id)}
                            title="Баннер прогресса сверху страницы"
                            className="text-xs font-semibold text-sky-400 hover:text-sky-300"
                          >
                            Следить
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

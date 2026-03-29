import { useState, useEffect, useCallback } from 'react'
import { useToast } from '../hooks/useToast'
import { useExtensionStatus } from '../context/ExtensionStatusContext'
import { apiUrl, apiOriginLabel, apiReachabilityUrl } from '../apiBase'
import type { ScraperRunRow } from './ScraperRunBanner'

function formatWhen(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusStyles(status: string) {
  const s = status.toLowerCase()
  if (s === 'running') return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
  if (s === 'done' || s === 'completed') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  if (s === 'error' || s === 'failed') return 'bg-rose-500/15 text-rose-300 border-rose-500/30'
  return 'bg-slate-500/15 text-slate-400 border-slate-500/30'
}

function runStatusLabel(status: string) {
  const s = status.toLowerCase()
  if (s === 'running') return 'выполняется'
  if (s === 'done' || s === 'completed') return 'готово'
  if (s === 'error' || s === 'failed') return 'ошибка'
  if (s === 'cancelled') return 'остановлен'
  return status
}

export function SettingsView() {
  const { toast } = useToast()
  const extensionStatus = useExtensionStatus()
  const [stats, setStats] = useState<{ totalLeads: number; enrichedLeads: number; runningJobs: number } | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [runs, setRuns] = useState<ScraperRunRow[]>([])
  const [runsError, setRunsError] = useState<string | null>(null)
  const [pinging, setPinging] = useState(false)
  const [lastPing, setLastPing] = useState<{ ok: boolean; ms: number; detail: string } | null>(null)
  const [capabilities, setCapabilities] = useState<{
    agentBridge: { configured: boolean; headerName: string }
    auth: { bypass: boolean }
    integrations: Record<string, boolean>
  } | null>(null)
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/scrapers/stats'))
      if (!res.ok) {
        setStatsError(`Статистика: HTTP ${res.status}`)
        setStats(null)
        return
      }
      setStatsError(null)
      setStats(await res.json())
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : 'Ошибка')
      setStats(null)
    }
  }, [])

  const loadRuns = useCallback(async (opts?: { bustCache?: boolean }) => {
    try {
      const q = new URLSearchParams({ limit: '25', scraper: '2gis' })
      if (opts?.bustCache) q.set('nocache', '1')
      const res = await fetch(apiUrl(`/api/scrapers/runs?${q.toString()}`))
      if (!res.ok) {
        setRunsError(`Запуски: HTTP ${res.status}`)
        setRuns([])
        return
      }
      setRunsError(null)
      const data = (await res.json()) as { runs?: ScraperRunRow[] }
      setRuns(data.runs ?? [])
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : 'Ошибка')
      setRuns([])
    }
  }, [])

  const loadCapabilities = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/system/capabilities'))
      if (!res.ok) {
        setCapabilitiesError(`Возможности: HTTP ${res.status}`)
        setCapabilities(null)
        return
      }
      setCapabilitiesError(null)
      setCapabilities(await res.json())
    } catch (e) {
      setCapabilitiesError(e instanceof Error ? e.message : 'Ошибка')
      setCapabilities(null)
    }
  }, [])

  useEffect(() => {
    void loadStats()
    void loadRuns({ bustCache: true })
    void loadCapabilities()
  }, [loadStats, loadRuns, loadCapabilities])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void loadStats()
      void loadRuns()
    }, 12_000)
    return () => window.clearInterval(id)
  }, [loadStats, loadRuns])

  const testConnection = async () => {
    setPinging(true)
    const start = performance.now()
    try {
      const url = apiReachabilityUrl()
      const res = await fetch(url, { method: 'GET' })
      const ms = Math.round(performance.now() - start)
      const ok = res.ok
      let detail = `${res.status}`
      if (url.includes('/health')) {
        try {
          const j = (await res.json()) as {
            status?: string
            service?: string
            healthy?: boolean
          }
          if (j.status) detail = j.status
          if (j.service === 'leadiya-api') detail = `${j.status ?? 'ok'} · Leadiya API`
          const wrongService =
            res.ok &&
            j.service !== 'leadiya-api' &&
            (j.healthy === true || (j.status !== 'ok' && j.status !== undefined))
          if (wrongService) {
            setLastPing({ ok: false, ms, detail: 'not-leadiya-api' })
            toast(
              '/health ответил, но это не API Leadiya (ожидается service: leadiya-api). Возможно, порт занят другим приложением — проверьте LEADIYA_API_ORIGIN / PORT.',
              'error',
            )
            return
          }
        } catch {
          /* ignore */
        }
      }
      setLastPing({ ok, ms, detail })
      if (ok) toast(`API доступен (${ms} мс)`, 'success')
      else toast(`API вернул ${res.status}`, 'error')
    } catch (e) {
      const ms = Math.round(performance.now() - start)
      setLastPing({ ok: false, ms, detail: e instanceof Error ? e.message : 'Ошибка' })
      toast('Не удалось достучаться до API', 'error')
    } finally {
      setPinging(false)
    }
  }

  return (
    <div className="animate-fade-in space-y-8 max-w-6xl">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-white">Настройки</h2>
        <p className="text-slate-500 text-sm mt-1 max-w-2xl">
          Статус workspace и выгрузки. Прогресс скрапера: <strong className="text-slate-400">задачи 2GIS</strong>. В продакшене задайте{' '}
          <code className="text-slate-400">VITE_PUBLIC_API_ORIGIN</code>; проксируйте <code className="text-slate-400">/api</code> и <code className="text-slate-400">/health</code>.
        </p>
      </div>

      <div className="crm-panel p-6 rounded-2xl space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">Как загружаются лиды</h3>
        <p className="text-sm text-slate-500 leading-relaxed">
          Таблица вызывает <code className="text-slate-400">GET /api/companies</code> с фильтрами (SQL на сервере). Потока и авто-опроса нет: обновление при смене страницы, сортировки, фильтров, паузе в поиске (~400 мс), по кнопке обновления или после задачи 2GIS. Списки фильтров из <code className="text-slate-400">GET /api/companies/filters-meta</code> — как в Postgres.
        </p>
      </div>

      <div className="crm-panel p-6 rounded-2xl space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">Расширение Chrome</h3>
        <p className="text-xs text-slate-500">
          Та же проверка, что в боковой панели: <code className="text-slate-400">postMessage</code> в этой вкладке (без WebSocket на отдельном порту).
        </p>
        <div
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${
            extensionStatus === 'connected'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-white/10 bg-slate-950/50 text-slate-400'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${extensionStatus === 'connected' ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          {extensionStatus === 'connected' ? 'Подключено' : extensionStatus === 'checking' ? 'Проверка…' : 'Нет связи'}
        </div>
      </div>

      <div className="crm-panel p-6 rounded-2xl space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">Подключение к API</h3>
        <p className="text-xs text-slate-500 leading-relaxed">{apiOriginLabel()}</p>
        <p className="text-[11px] text-slate-600 font-mono break-all">Проверка URL: {apiReachabilityUrl()}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pinging}
            onClick={() => void testConnection()}
            className="px-4 py-2 rounded-xl bg-slate-800 border border-white/10 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            {pinging ? 'Проверка…' : 'Проверить соединение'}
          </button>
          <button
            type="button"
            onClick={() => {
              void loadStats()
              void loadRuns({ bustCache: true })
              void loadCapabilities()
              toast('Данные обновлены', 'success')
            }}
            className="px-4 py-2 rounded-xl border border-white/10 text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5"
          >
            Обновить данные
          </button>
          {lastPing && (
            <span className={`text-xs font-semibold ${lastPing.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
              {lastPing.ok ? 'ОК' : 'Сбой'} · {lastPing.ms} мс · {lastPing.detail}
            </span>
          )}
        </div>
        {statsError && <p className="text-xs text-rose-400">{statsError}</p>}
      </div>

      <div className="crm-panel p-6 rounded-2xl space-y-4">
        <h3 className="text-sm font-semibold text-slate-200">Мост агента (Hermes / Leadiya)</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          Внешний оператор (Hermes) вызывает REST API с заголовком{' '}
          <code className="text-slate-400">{capabilities?.agentBridge.headerName ?? 'X-Leadiya-Service-Key'}</code>. На стороне API задайте{' '}
          <code className="text-slate-400">LEADIYA_AGENT_SERVICE_KEY</code> (тот же секрет в Hermes как{' '}
          <code className="text-slate-400">LEADIYA_AGENT_SERVICE_KEY</code> или в конфиге инструментов). Подробнее:{' '}
          <a
            className="text-brand-400 hover:underline"
            href="https://github.com/DaurenNope/leadiya/blob/main/docs/HERMES_INTEGRATION.md"
            target="_blank"
            rel="noreferrer"
          >
            docs/HERMES_INTEGRATION.md
          </a>
          {' · '}
          <a
            className="text-brand-400 hover:underline"
            href="https://github.com/DaurenNope/leadiya/blob/main/docs/hermes-tools.manifest.json"
            target="_blank"
            rel="noreferrer"
          >
            manifest инструментов
          </a>
        </p>
        {capabilitiesError && <p className="text-xs text-rose-400">{capabilitiesError}</p>}
        {capabilities && (
          <div className="flex flex-wrap gap-3">
            <div
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${
                capabilities.agentBridge.configured
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${capabilities.agentBridge.configured ? 'bg-emerald-400' : 'bg-amber-400'}`}
              />
              {capabilities.agentBridge.configured ? 'Ключ агента задан на API' : 'Ключ агента не задан — Hermes не сможет вызывать /api'}
            </div>
            {capabilities.auth.bypass && (
              <span className="inline-flex items-center px-3 py-2 rounded-lg border border-slate-500/30 bg-slate-950/50 text-xs text-slate-400">
                AUTH_BYPASS (только dev)
              </span>
            )}
          </div>
        )}
        <p className="text-[11px] text-slate-600 font-mono">
          Hermes: LEADIYA_API_BASE_URL = origin этого API (например {apiOriginLabel()})
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="crm-panel p-6 rounded-2xl space-y-1">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Всего лидов</span>
          <div className="text-3xl font-bold text-brand-400 tabular-nums">{stats?.totalLeads?.toLocaleString() ?? '—'}</div>
        </div>
        <div className="crm-panel p-6 rounded-2xl space-y-1">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Обогащено</span>
          <div className="text-3xl font-bold text-emerald-400 tabular-nums">{stats?.enrichedLeads?.toLocaleString() ?? '—'}</div>
        </div>
        <div className="crm-panel p-6 rounded-2xl space-y-1">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Скраперы в работе</span>
          <div className="text-3xl font-bold text-amber-400 tabular-nums">{stats?.runningJobs ?? '—'}</div>
        </div>
      </div>

      <div className="crm-panel p-6 rounded-2xl">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h3 className="text-sm font-bold text-slate-200">Последние запуски 2GIS</h3>
          <span className="text-[10px] text-slate-500">Обновление ~12 с</span>
        </div>
        {runsError && <p className="text-xs text-rose-400 mb-3">{runsError}</p>}
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-500">
                <th className="p-3 font-semibold">Старт</th>
                <th className="p-3 font-semibold">Статус</th>
                <th className="p-3 font-semibold">Записей</th>
                <th className="p-3 font-semibold">Ошибка</th>
                <th className="p-3 font-semibold">ID запуска</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && !runsError ? (
                <tr>
                  <td colSpan={5} className="p-6 text-slate-500 text-center">
                    Запусков пока нет. Запустите задачу кнопкой <strong className="text-slate-400">Новая задача 2GIS</strong> в боковой панели.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-3 text-slate-300 whitespace-nowrap">{formatWhen(r.startedAt)}</td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase ${statusStyles(r.status)}`}>
                        {runStatusLabel(r.status)}
                      </span>
                    </td>
                    <td className="p-3 text-slate-300 font-mono tabular-nums">{r.resultsCount ?? '—'}</td>
                    <td className="p-3 text-rose-300/90 max-w-xs truncate" title={r.error ?? undefined}>
                      {r.error ?? '—'}
                    </td>
                    <td className="p-3 text-slate-500 font-mono text-[10px]">{r.id.slice(0, 8)}…</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="crm-panel p-6 rounded-2xl">
          <h3 className="text-sm font-bold text-slate-200 mb-3">Источники обогащения</h3>
          <p className="text-[11px] text-slate-500 mb-4">
            Статусы справочные, пока API не отдаёт реальное здоровье сервисов.
          </p>
          <div className="space-y-2">
            {[
              { name: 'Совпадение имени 2GIS', desc: 'Кросс-обогащение через поиск', status: 'active' as const },
              { name: 'Сайт', desc: 'HTTP + Playwright', status: 'active' as const },
              { name: 'stat.gov.kz', desc: 'Сотрудники / выручка', status: 'degraded' as const },
              { name: 'uchet.kz', desc: 'Юрданные / ОКЭД', status: 'needs_token' as const },
              { name: 'goszakup.gov.kz', desc: 'Тендеры', status: 'needs_token' as const },
            ].map((src) => (
              <div key={src.name} className="flex items-center justify-between p-3 bg-slate-950/40 rounded-xl border border-white/5">
                <div>
                  <div className="text-xs font-semibold text-slate-200">{src.name}</div>
                  <div className="text-[10px] text-slate-500">{src.desc}</div>
                </div>
                <span
                  className={`text-[9px] font-bold uppercase px-2 py-1 rounded-lg border ${
                    src.status === 'active'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : src.status === 'degraded'
                        ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                        : 'bg-slate-500/10 border-slate-500/20 text-slate-400'
                  }`}
                >
                  {src.status === 'active'
                    ? 'активен'
                    : src.status === 'degraded'
                      ? 'снижен'
                      : 'нужен токен'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="crm-panel p-6 rounded-2xl">
          <h3 className="text-sm font-bold text-slate-200 mb-4">Действия</h3>
          <div className="space-y-3">
            <button
              onClick={() => {
                const url = apiUrl('/api/companies/export')
                const a = document.createElement('a')
                a.href = url
                a.download = 'leads.csv'
                a.click()
                toast('Загрузка начата', 'success')
              }}
              className="w-full p-4 bg-slate-950/40 border border-white/5 rounded-xl text-xs font-semibold text-slate-300 hover:bg-brand-500/10 hover:border-brand-500/25 hover:text-brand-300 transition-all text-left"
            >
              Экспорт лидов (CSV)
            </button>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(apiUrl('/api/scrapers/re-enrich'), { method: 'POST' })
                  const data = (await res.json()) as { count?: number }
                  if (data.count && data.count > 0) {
                    toast(`В очередь на повторное обогащение: ${data.count} лидов`, 'success')
                  } else {
                    toast('Нет «устаревших» лидов (30+ дней)', 'info')
                  }
                } catch {
                  toast('Запрос не выполнен', 'error')
                }
              }}
              className="w-full p-4 bg-slate-950/40 border border-white/5 rounded-xl text-xs font-semibold text-slate-300 hover:bg-brand-500/10 hover:border-brand-500/25 hover:text-brand-300 transition-all text-left"
            >
              Повторно обогатить устаревшие (30+ дней)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

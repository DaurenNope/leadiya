import { useState, useEffect, useRef, useCallback } from 'react'
import { LeadsTable } from './components/LeadsTable'
import { DiscoveryModal } from './components/DiscoveryModal'
import { ExtensionHub } from './components/ExtensionHub'
import { SettingsView } from './components/SettingsView'
import { ScrapersView } from './components/ScrapersView'
import { CrmView } from './components/CrmView'
import { WhatsAppInboxView } from './components/WhatsAppInboxView'
import { LeadSidePanel } from './components/LeadSidePanel'
import { ScraperRunBanner } from './components/ScraperRunBanner'
import { OverviewView } from './components/OverviewView'
import { AuthPage } from './components/AuthPage'
import { useAuth } from './context/AuthContext'
import { useToast } from './hooks/useToast'
import { useExtensionStatus } from './context/ExtensionStatusContext'
import type { Lead } from './types'
import { apiUrl, authFetch } from './apiBase'

type View = 'home' | 'intelligence' | 'crm' | 'whatsapp' | 'scrapers' | 'operations' | 'system'

type ScraperRun = {
  id: string
  scraper: string
  status: string
  resultsCount: number | null
  error: string | null
  startedAt: string | null
  completedAt: string | null
}

function formatRunTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** API persists `done` / `error`; older rows may use other strings. */
function scraperRunVisual(status: string) {
  const s = status.toLowerCase()
  if (s === 'done' || s === 'completed') {
    return {
      chip: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
      label: 'готово',
      kind: 'done' as const,
    }
  }
  if (s === 'running') {
    return {
      chip: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
      label: 'идёт',
      kind: 'running' as const,
    }
  }
  if (s === 'cancelled') {
    return {
      chip: 'bg-slate-500/10 border-slate-500/25 text-slate-400',
      label: 'остановлен',
      kind: 'cancelled' as const,
    }
  }
  return {
    chip: 'bg-rose-500/10 border-rose-500/25 text-rose-400',
    label: s || 'неизв.',
    kind: 'error' as const,
  }
}

type WaConnStatus = 'connected' | 'waiting_qr' | 'disconnected'

export default function App() {
  const { user, loading: authLoading, signOut } = useAuth()

  const [view, setView] = useState<View>('home')
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false)
  const extensionStatus = useExtensionStatus()
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [scraperRuns2gis, setScraperRuns2gis] = useState<ScraperRun[]>([])
  const [runsFetchError, setRunsFetchError] = useState<string | null>(null)
  const [activeScrapeRunId, setActiveScrapeRunId] = useState<string | null>(null)
  const [leadsRefreshNonce, setLeadsRefreshNonce] = useState(0)
  const [crmSeedLeadId, setCrmSeedLeadId] = useState<string | null>(null)
  /** When set, Leads list filters to leads saved under this 2GIS run (raw_data). */
  const [leadsScraperRunFilter, setLeadsScraperRunFilter] = useState<string | null>(null)
  const [waConnStatus, setWaConnStatus] = useState<WaConnStatus | null>(null)
  const mainScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await authFetch(apiUrl('/api/outreach/whatsapp/status'))
        if (res.ok) {
          const data = (await res.json()) as { status: string }
          const s = data.status
          setWaConnStatus(s === 'connected' ? 'connected' : s === 'waiting_qr' ? 'waiting_qr' : 'disconnected')
        }
      } catch { /* ignore */ }
    }
    void poll()
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void poll()
    }, 15_000)
    return () => window.clearInterval(id)
  }, [])

  const scrollMainToTop = useCallback(() => {
    requestAnimationFrame(() => {
      mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }, [])

  const loadScraperRuns = useCallback(async (opts?: { bustCache?: boolean }) => {
    try {
      const q = new URLSearchParams({ limit: '12', scraper: '2gis' })
      if (opts?.bustCache) q.set('nocache', '1')
      const res = await authFetch(apiUrl(`/api/scrapers/runs?${q.toString()}`))
      if (!res.ok) {
        setRunsFetchError('API запусков недоступен')
        return
      }
      setRunsFetchError(null)
      const data = await res.json() as { runs: ScraperRun[] }
      setScraperRuns2gis(data.runs ?? [])
    } catch {
      setRunsFetchError('API запусков недоступен')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + interval refresh
    void loadScraperRuns({ bustCache: true })
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void loadScraperRuns()
    }, 45_000)
    return () => clearInterval(id)
  }, [loadScraperRuns])

  const hasActive2gisPoll =
    activeScrapeRunId != null ||
    scraperRuns2gis.some((r) => (r.status ?? '').toLowerCase() === 'running')

  useEffect(() => {
    if (!hasActive2gisPoll) return
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void loadScraperRuns()
    }, 8_000)
    return () => window.clearInterval(id)
  }, [hasActive2gisPoll, loadScraperRuns])

  const latest2gisRun = scraperRuns2gis[0]

  const { toast } = useToast()

  const handleCrmSeedConsumed = useCallback(() => {
    setCrmSeedLeadId(null)
  }, [])

  /** Watch: pin banner, jump to leads list filtered by this run, scroll up. */
  const pinScrapeRun = useCallback(
    (id: string) => {
      setActiveScrapeRunId(id)
      setLeadsScraperRunFilter(id)
      setView('intelligence')
      scrollMainToTop()
      toast('Список лидов отфильтрован по этому запуску; прогресс — в баннере сверху.', 'info')
    },
    [scrollMainToTop, toast],
  )

  const handleLaunchDiscovery = async (payload: {
    cities: string[]
    categories: string[]
    skipProxy?: boolean
    /** false = visible Chromium (local debug; API machine must have display or use Xvfb). */
    headless?: boolean
  }) => {
    try {
      const res = await authFetch(apiUrl('/api/scrapers/2gis'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as {
        runId?: string
        existing?: boolean
        message?: string
        error?: string
        code?: string
      }

      if (!res.ok) {
        const msg =
          typeof data.error === 'string'
            ? data.error
            : res.status === 400
              ? 'Некорректные параметры сбора'
              : 'Не удалось запустить сбор'
        toast(msg, 'error')
        return
      }

      if (typeof data.runId === 'string' && data.runId.length > 0) {
        setActiveScrapeRunId(data.runId)
        scrollMainToTop()
      }

      await loadScraperRuns({ bustCache: true })
      const idShort = data.runId ? data.runId.slice(0, 8) : null
      const suffix = idShort ? ` (запуск ${idShort}…)` : ''
      if (data.existing) {
        toast(`Скрапер уже выполняется${suffix}`, 'info')
      } else {
        toast(`Задача 2GIS запущена${suffix}`, 'success')
      }
    } catch (err) {
      console.error(err)
      toast('Не удалось запустить сбор', 'error')
    }
  }

  const workspaces = [
    {
      label: 'Рабочий стол',
      items: [
        {
          id: 'home',
          label: 'Обзор',
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect width="7" height="9" x="3" y="3" rx="1" />
              <rect width="7" height="5" x="14" y="3" rx="1" />
              <rect width="7" height="9" x="14" y="12" rx="1" />
              <rect width="7" height="5" x="3" y="16" rx="1" />
            </svg>
          ),
        },
      ],
    },
    {
      label: 'Лиды',
      items: [
        {
          id: 'intelligence',
          label: 'Список лидов',
          icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        },
      ],
    },
    {
      label: 'Работа с лидами',
      items: [
        {
          id: 'crm',
          label: 'CRM',
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          ),
        },
        {
          id: 'whatsapp',
          label: 'WhatsApp',
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          ),
        },
      ],
    },
    {
      label: 'Сбор',
      items: [
        {
          id: 'scrapers',
          label: 'Задачи 2GIS',
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M7 12h4" />
              <path d="M7 8h10" />
              <path d="M7 16h7" />
            </svg>
          ),
        },
        {
          id: 'operations',
          label: 'Расширение',
          icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v8"/><path d="m4.93 4.93 2.83 2.83"/><path d="M2 12h8"/><path d="m4.93 19.07 2.83-2.83"/><path d="M12 22v-8"/><path d="m19.07 19.07-2.83-2.83"/><path d="M22 12h-8"/><path d="m19.07 4.93-2.83 2.83"/></svg>
        },
      ],
    },
    {
      label: 'Система',
      items: [
        {
          id: 'system',
          label: 'Настройки',
          icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        },
      ],
    },
  ]

  const viewTitle =
    view === 'home'
      ? 'Обзор'
      : view === 'intelligence'
        ? 'Список лидов'
        : view === 'crm'
          ? 'CRM'
          : view === 'whatsapp'
            ? 'WhatsApp'
            : view === 'scrapers'
              ? 'Задачи 2GIS'
              : view === 'operations'
                ? 'Расширение'
                : 'Настройки'

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#020617]">
        <div className="w-10 h-10 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <AuthPage />

  return (
    <div className="flex h-screen overflow-hidden font-sans text-slate-50 bg-[#020617] bg-[radial-gradient(ellipse_100%_60%_at_50%_-10%,rgba(14,165,233,0.07),transparent_55%)]">
      {/* Sidebar Workspace */}
      <aside 
        className={`relative h-full glass-sidebar flex flex-col p-6 z-50 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${isSidebarCollapsed ? 'w-24' : 'w-72'}`}
      >
        {/* Collapse Toggle */}
        <button 
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="absolute -right-3 top-24 w-6 h-6 bg-slate-900 border border-white/10 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:border-brand-500/50 shadow-xl z-50 transition-all hover:scale-110 active:scale-95 profile-ring"
        >
          <svg 
            className={`transition-transform duration-500 ${isSidebarCollapsed ? 'rotate-180' : ''}`}
            xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>

        <div className={`flex items-center gap-3 px-2 mb-10 transition-all duration-500 ${isSidebarCollapsed ? 'justify-center px-0' : ''}`}>
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-[#020617] shadow-lg shadow-sky-500/20 relative group overflow-hidden shrink-0 bg-gradient-to-br from-sky-400 to-cyan-600">
            <div className="absolute inset-0 bg-white/25 -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
            L
          </div>
          {!isSidebarCollapsed && (
            <div className="animate-in fade-in slide-in-from-left-2 duration-500">
              <h1 className="text-lg font-semibold tracking-tight text-slate-100">Leadiya</h1>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">KZ B2B · лиды и рассылки</p>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-10 mt-4 overflow-y-auto no-scrollbar">
          {workspaces.map((ws, i) => (
            <div key={i} className="space-y-2">
              {!isSidebarCollapsed && (
                <h3 className="px-4 text-xs font-medium text-slate-500 mb-3 animate-in fade-in duration-700">
                  {ws.label}
                </h3>
              )}
              <div className="space-y-1">
                {ws.items.map((item) => {
                  const isWa = item.id === 'whatsapp'
                  const waDotColor =
                    waConnStatus === 'connected'
                      ? 'bg-emerald-400'
                      : waConnStatus === 'waiting_qr'
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-slate-500'
                  return (
                    <button 
                      key={item.id}
                      onClick={() => setView(item.id as View)}
                      title={isSidebarCollapsed ? item.label : undefined}
                      className={`w-full sidebar-item flex items-center ${isSidebarCollapsed ? 'justify-center px-0' : 'px-4'} ${view === item.id ? 'sidebar-item-active' : ''}`}
                    >
                      <div className="shrink-0 flex items-center justify-center relative">
                        {item.icon}
                        {isWa && isSidebarCollapsed && waConnStatus != null && (
                          <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${waDotColor}`} />
                        )}
                      </div>
                      {!isSidebarCollapsed && (
                        <span className="ml-3 truncate animate-in fade-in slide-in-from-left-2 duration-300 flex items-center gap-2">
                          {item.label}
                          {isWa && waConnStatus != null && (
                            <span className={`w-2 h-2 rounded-full shrink-0 ${waDotColor}`} />
                          )}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto pt-6 border-t border-white/5 space-y-4">
          {/* User info + sign out */}
          {!isSidebarCollapsed && user?.email && (
            <div className="flex items-center justify-between px-2">
              <span className="text-xs text-slate-500 truncate max-w-[10rem]" title={user.email}>{user.email}</span>
              <button
                onClick={() => signOut()}
                className="text-xs text-slate-600 hover:text-rose-400 transition-colors"
                title="Выйти"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              </button>
            </div>
          )}
          {isSidebarCollapsed && (
            <div className="flex justify-center">
              <button
                onClick={() => signOut()}
                className="text-slate-600 hover:text-rose-400 transition-colors"
                title="Выйти"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              </button>
            </div>
          )}

          <div className={`flex items-center justify-between px-2 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
            {!isSidebarCollapsed && (
              <span className="text-xs font-semibold text-slate-500">Расширение</span>
            )}
            <div
              title={
                extensionStatus === 'connected'
                  ? 'Расширение Leadiya ответило в этой вкладке через postMessage (мост контент-скрипта).'
                  : extensionStatus === 'checking'
                    ? 'Проверка связи с расширением…'
                    : 'Установите и включите расширение Leadiya, откройте эту панель в том же профиле Chrome и обновите вкладку.'
              }
              className={`px-2 py-0.5 rounded text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-default ${
                extensionStatus === 'connected'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : extensionStatus === 'checking'
                    ? 'bg-slate-500/10 border-slate-500/25 text-slate-400'
                    : 'bg-slate-500/10 border-slate-500/25 text-slate-400'
              } ${isSidebarCollapsed ? 'w-3 h-3 p-0 rounded-full border-0 justify-center' : ''}`}
            >
              <div
                className={`w-1 h-1 rounded-full ${
                  extensionStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
              {!isSidebarCollapsed &&
                (extensionStatus === 'connected' ? 'Подключено' : extensionStatus === 'checking' ? 'Проверка…' : 'Нет связи')}
            </div>
          </div>

          {!isSidebarCollapsed && (
            <div className="px-2 space-y-2 border-t border-white/5 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Задачи 2GIS</span>
                {latest2gisRun?.status === 'running' && (
                  <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest animate-pulse">Идёт</span>
                )}
              </div>
              {runsFetchError && (
                <p className="text-xs text-rose-400/90 leading-snug">{runsFetchError}</p>
              )}
              {!runsFetchError && scraperRuns2gis.length === 0 && (
                <p className="text-[9px] text-slate-600 font-medium">Запусков пока нет.</p>
              )}
              <ul className="space-y-1.5 max-h-[7.5rem] overflow-y-auto no-scrollbar">
                {scraperRuns2gis.slice(0, 6).map((run) => {
                  const { chip, label } = scraperRunVisual(run.status)
                  const detail =
                    (run.status === 'error' || run.status === 'failed') && run.error
                      ? run.error.slice(0, 72) + (run.error.length > 72 ? '…' : '')
                      : run.resultsCount != null
                        ? `${run.resultsCount} сохр.`
                        : '—'
                  return (
                    <li
                      key={run.id}
                      className="flex items-start justify-between gap-2 rounded-lg bg-white/[0.02] border border-white/5 px-2 py-1.5"
                    >
                      <span className="text-xs text-slate-500 tabular-nums shrink-0">{formatRunTime(run.startedAt)}</span>
                      <div className="min-w-0 flex-1 text-right">
                        <span className={`inline-block text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${chip}`}>
                          {label}
                        </span>
                        <p className="text-[10px] text-slate-500 mt-0.5 truncate" title={run.error ?? undefined}>
                          {detail}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {isSidebarCollapsed && latest2gisRun && (
            <div className="flex justify-center" title={`2GIS: ${latest2gisRun.status}`}>
              <div
                className={`w-2 h-2 rounded-full ${
                  scraperRunVisual(latest2gisRun.status).kind === 'done'
                    ? 'bg-emerald-500'
                    : latest2gisRun.status === 'running'
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-rose-500'
                }`}
              />
            </div>
          )}
          
          <button 
            onClick={() => setIsDiscoveryOpen(true)}
            className={`w-full bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-400 hover:to-cyan-400 text-[#020617] rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-sky-500/25 transition-all flex items-center justify-center gap-2.5 active:scale-[0.98] group ${isSidebarCollapsed ? 'h-12 w-12 mx-auto px-0 rounded-xl' : 'py-4'}`}
          >
            <svg className="group-hover:rotate-90 transition-transform duration-300" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            {!isSidebarCollapsed && 'Новая задача 2GIS'}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#020617] relative">
        <header className="min-h-[4.5rem] py-3 glass-header flex items-center justify-between px-8 sm:px-10 relative z-40">
          <div className="min-w-0 max-w-[min(100%,42rem)]">
            <h2 className="text-base sm:text-lg font-semibold text-slate-100 tracking-tight">{viewTitle}</h2>
            <p className="text-sm text-slate-500 mt-1 leading-relaxed">
              {view === 'home'
                ? 'Ключевые метрики, активность и состояние всех систем.'
                : view === 'intelligence'
                  ? 'Все собранные компании. Кликните на строку для подробностей.'
                  : view === 'crm'
                    ? 'Выберите компанию и отправьте сообщение через WhatsApp или почту.'
                    : view === 'whatsapp'
                      ? 'Все диалоги WhatsApp: входящие и исходящие.'
                      : view === 'scrapers'
                        ? 'Запуски сбора данных с 2GIS и их статусы.'
                        : view === 'operations'
                          ? 'Статус подключения расширения Chrome для автоматического сбора.'
                          : 'Подключения, автоматизация, настройки рассылок и данные.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={`hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium ${
                extensionStatus === 'connected'
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/10 bg-slate-900/80 text-slate-500'
              }`}
              title="Мост расширения: postMessage в этой вкладке"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${extensionStatus === 'connected' ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              Расширение{' '}
              {extensionStatus === 'connected' ? 'вкл.' : extensionStatus === 'checking' ? '…' : 'выкл.'}
            </div>
          </div>
        </header>

        <div ref={mainScrollRef} className="flex-1 overflow-y-auto p-10 relative z-30 space-y-6">
          {activeScrapeRunId && (
            <div className="sticky top-0 z-20 -mx-10 mb-2 border-b border-white/10 bg-[#020617]/92 px-10 py-3 backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
              <ScraperRunBanner
                runId={activeScrapeRunId}
                onDismiss={() => setActiveScrapeRunId(null)}
                onOpenLeadList={() => {
                  setLeadsScraperRunFilter(activeScrapeRunId)
                  setView('intelligence')
                }}
                onOpenScrapers={() => setView('scrapers')}
                onRunFinished={(outcome) => {
                  void loadScraperRuns({ bustCache: true })
                  if (outcome === 'done') {
                    setLeadsRefreshNonce((n) => n + 1)
                  }
                }}
              />
            </div>
          )}
          {view === 'home' && (
            <OverviewView
              onOpenLeads={() => setView('intelligence')}
              onOpenSettings={() => setView('system')}
              onOpenScrapers={() => setView('scrapers')}
              onOpenExtension={() => setView('operations')}
              onOpenCrm={() => setView('crm')}
              onOpenDiscovery={() => setIsDiscoveryOpen(true)}
              onOpenWhatsApp={() => setView('whatsapp')}
            />
          )}
          {view === 'intelligence' && (
            <LeadsTable
              onLeadClick={setSelectedLead}
              refreshNonce={leadsRefreshNonce}
              scraperRunIdFilter={leadsScraperRunFilter}
              onClearScraperRunFilter={() => setLeadsScraperRunFilter(null)}
            />
          )}
          {view === 'crm' && (
            <CrmView
              seedLeadId={crmSeedLeadId}
              onSeedConsumed={handleCrmSeedConsumed}
              onBrowseLeads={() => setView('intelligence')}
              onOpenWhatsApp={() => setView('whatsapp')}
            />
          )}
          {view === 'whatsapp' && (
            <WhatsAppInboxView
              onWorkLead={(id) => {
                setCrmSeedLeadId(id)
                setView('crm')
              }}
              onBrowseLeads={() => setView('intelligence')}
              onOpenCrm={() => {
                setCrmSeedLeadId(null)
                setView('crm')
              }}
              onOpenSettings={() => setView('system')}
            />
          )}
          {view === 'scrapers' && (
            <ScrapersView
              onOpenDiscovery={() => setIsDiscoveryOpen(true)}
              onWatchRun={(id) => pinScrapeRun(id)}
              onOpenLeadList={() => setView('intelligence')}
            />
          )}
          {view === 'operations' && <ExtensionHub />}
          {view === 'system' && <SettingsView />}
        </div>

        {/* Dynamic Background Effects */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand-500/5 blur-[120px] rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-indigo-500/5 blur-[100px] rounded-full translate-y-1/2 -translate-x-1/2 pointer-events-none"></div>
      </main>

      <DiscoveryModal 
        isOpen={isDiscoveryOpen} 
        onClose={() => setIsDiscoveryOpen(false)} 
        onLaunch={handleLaunchDiscovery}
      />

      {selectedLead && (
        <LeadSidePanel 
          lead={selectedLead} 
          onClose={() => setSelectedLead(null)} 
        />
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { LeadsTable } from './components/LeadsTable'
import { DiscoveryModal } from './components/DiscoveryModal'
import { ExtensionHub } from './components/ExtensionHub'
import { SettingsView } from './components/SettingsView'
import { LeadSidePanel } from './components/LeadSidePanel'
import { useToast } from './hooks/useToast'
import type { Lead } from './types'

type View = 'intelligence' | 'operations' | 'system'

type ScraperRun = {
  id: string
  scraper: string
  status: string
  resultsCount: string | null
  error: string | null
  startedAt: string | null
  completedAt: string | null
}

function formatRunTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** API persists `done` / `error`; older rows may use other strings. */
function scraperRunVisual(status: string) {
  const s = status.toLowerCase()
  if (s === 'done' || s === 'completed') {
    return {
      chip: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400',
      label: 'done',
    }
  }
  if (s === 'running') {
    return {
      chip: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
      label: 'running',
    }
  }
  return {
    chip: 'bg-rose-500/10 border-rose-500/25 text-rose-400',
    label: s || 'unknown',
  }
}

export default function App() {
  const [view, setView] = useState<View>('intelligence')
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false)
  const [extensionStatus, setExtensionStatus] = useState<'connected' | 'disconnected'>('disconnected')
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [scraperRuns2gis, setScraperRuns2gis] = useState<ScraperRun[]>([])
  const [runsFetchError, setRunsFetchError] = useState<string | null>(null)

  useEffect(() => {
    const checkExtension = () => {
      const ws = new WebSocket('ws://localhost:8765')
      ws.onopen = () => {
        setExtensionStatus('connected')
        ws.close()
      }
      ws.onerror = () => {
        setExtensionStatus('disconnected')
      }
    }
    checkExtension()
    const interval = setInterval(checkExtension, 10000)
    return () => clearInterval(interval)
  }, [])

  const loadScraperRuns = async () => {
    try {
      const res = await fetch('/api/scrapers/runs?limit=12&scraper=2gis')
      if (!res.ok) {
        setRunsFetchError('Runs API unavailable')
        return
      }
      setRunsFetchError(null)
      const data = await res.json() as { runs: ScraperRun[] }
      setScraperRuns2gis(data.runs ?? [])
    } catch {
      setRunsFetchError('Runs API unavailable')
    }
  }

  useEffect(() => {
    void loadScraperRuns()
    const id = setInterval(() => void loadScraperRuns(), 45_000)
    return () => clearInterval(id)
  }, [])

  const latest2gisRun = scraperRuns2gis[0]

  const { toast } = useToast()

  const handleLaunchDiscovery = async (payload: { cities: string[]; categories: string[] }) => {
    try {
      const res = await fetch('/api/scrapers/2gis', {
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
              ? 'Invalid discovery parameters'
              : 'Failed to start discovery'
        toast(msg, 'error')
        return
      }

      await loadScraperRuns()
      const idShort = data.runId ? data.runId.slice(0, 8) : null
      const suffix = idShort ? ` (run ${idShort}…)` : ''
      if (data.existing) {
        toast(`Scraper already running${suffix}`, 'info')
      } else {
        toast(`Discovery job started${suffix}`, 'success')
      }
    } catch (err) {
      console.error(err)
      toast('Failed to launch discovery', 'error')
    }
  }

  const workspaces = [
    {
      label: 'Market Intelligence',
      items: [
        {
          id: 'intelligence',
          label: 'Global Registry',
          icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        },
      ],
    },
    {
      label: 'Discovery Ops',
      items: [
        {
          id: 'operations',
          label: 'Extension Hub',
          icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v8"/><path d="m4.93 4.93 2.83 2.83"/><path d="M2 12h8"/><path d="m4.93 19.07 2.83-2.83"/><path d="M12 22v-8"/><path d="m19.07 19.07-2.83-2.83"/><path d="M22 12h-8"/><path d="m19.07 4.93-2.83 2.83"/></svg>
        },
      ],
    },
    {
      label: 'Core System',
      items: [
        {
          id: 'system',
          label: 'Global Settings',
          icon: <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        },
      ],
    },
  ]

  return (
    <div className="flex h-screen bg-[#020617] text-slate-50 overflow-hidden font-sans select-none">
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
          <div className="w-10 h-10 bg-brand-500 rounded-2xl flex items-center justify-center font-black text-white shadow-2xl shadow-brand-500/40 relative group overflow-hidden shrink-0">
            <div className="absolute inset-0 bg-white/20 -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
            L
          </div>
          {!isSidebarCollapsed && (
            <div className="animate-in fade-in slide-in-from-left-2 duration-500">
              <h1 className="text-xl font-black tracking-tight premium-gradient-text">Leadiya</h1>
              <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mt-0.5">Scraper OS v2.4</p>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-10 mt-4 overflow-y-auto no-scrollbar">
          {workspaces.map((ws, i) => (
            <div key={i} className="space-y-2">
              {!isSidebarCollapsed && (
                <h3 className="px-4 text-[9px] font-black text-slate-600 uppercase tracking-widest mb-4 animate-in fade-in duration-700">
                  {ws.label}
                </h3>
              )}
              <div className="space-y-1">
                {ws.items.map((item) => (
                  <button 
                    key={item.id}
                    onClick={() => setView(item.id as View)}
                    title={isSidebarCollapsed ? item.label : undefined}
                    className={`w-full sidebar-item flex items-center ${isSidebarCollapsed ? 'justify-center px-0' : 'px-4'} ${view === item.id ? 'sidebar-item-active' : ''}`}
                  >
                    <div className="shrink-0 flex items-center justify-center">
                      {item.icon}
                    </div>
                    {!isSidebarCollapsed && (
                      <span className="ml-3 truncate animate-in fade-in slide-in-from-left-2 duration-300">
                        {item.label}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto pt-6 border-t border-white/5 space-y-4">
          <div className={`flex items-center justify-between px-2 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
            {!isSidebarCollapsed && (
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</span>
            )}
            <div className={`px-2 py-0.5 rounded text-[8px] font-black border flex items-center gap-1.5 transition-all ${
              extensionStatus === 'connected' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            } ${isSidebarCollapsed ? 'w-3 h-3 p-0 rounded-full border-0 justify-center' : ''}`}>
              <div className={`w-1 h-1 rounded-full ${extensionStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`}></div>
              {!isSidebarCollapsed && (extensionStatus === 'connected' ? 'EXT_LINK_ON' : 'EXT_LINK_OFF')}
            </div>
          </div>

          {!isSidebarCollapsed && (
            <div className="px-2 space-y-2 border-t border-white/5 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">2GIS jobs</span>
                {latest2gisRun?.status === 'running' && (
                  <span className="text-[8px] font-black text-amber-400 uppercase tracking-widest animate-pulse">Running</span>
                )}
              </div>
              {runsFetchError && (
                <p className="text-[9px] text-rose-400/90 leading-snug">{runsFetchError}</p>
              )}
              {!runsFetchError && scraperRuns2gis.length === 0 && (
                <p className="text-[9px] text-slate-600 font-medium">No recorded runs yet.</p>
              )}
              <ul className="space-y-1.5 max-h-[7.5rem] overflow-y-auto no-scrollbar">
                {scraperRuns2gis.slice(0, 6).map((run) => {
                  const { chip, label } = scraperRunVisual(run.status)
                  const detail =
                    (run.status === 'error' || run.status === 'failed') && run.error
                      ? run.error.slice(0, 72) + (run.error.length > 72 ? '…' : '')
                      : run.resultsCount != null
                        ? `${run.resultsCount} saved`
                        : '—'
                  return (
                    <li
                      key={run.id}
                      className="flex items-start justify-between gap-2 rounded-lg bg-white/[0.02] border border-white/5 px-2 py-1.5"
                    >
                      <span className="text-[9px] text-slate-500 tabular-nums shrink-0">{formatRunTime(run.startedAt)}</span>
                      <div className="min-w-0 flex-1 text-right">
                        <span className={`inline-block text-[7px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${chip}`}>
                          {label}
                        </span>
                        <p className="text-[8px] text-slate-500 mt-0.5 truncate" title={run.error ?? undefined}>
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
                  scraperRunVisual(latest2gisRun.status).label === 'done'
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
            className={`w-full bg-brand-500 hover:bg-brand-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-brand-500/20 transition-all flex items-center justify-center gap-2.5 active:scale-[0.98] group ${isSidebarCollapsed ? 'h-12 w-12 mx-auto px-0 rounded-xl' : 'py-4'}`}
          >
            <svg className="group-hover:rotate-90 transition-transform duration-300" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
            {!isSidebarCollapsed && "New Job"}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#020617] relative">
        <header className="h-20 glass-header flex items-center justify-between px-10 relative z-40">
          <div>
             <h2 className="text-sm font-bold text-slate-400 uppercase tracking-[0.2em]">{view}</h2>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex -space-x-3">
               {[1,2,3].map(i => (
                 <div key={i} className="w-8 h-8 rounded-full border-2 border-[#020617] bg-slate-800"></div>
               ))}
            </div>
            <div className="w-10 h-10 rounded-2xl bg-slate-900 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all cursor-pointer group hover:border-brand-500/50">
               <svg className="group-hover:rotate-12 transition-transform" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-10 relative z-30">
          {view === 'intelligence' && <LeadsTable onLeadClick={setSelectedLead} />}
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

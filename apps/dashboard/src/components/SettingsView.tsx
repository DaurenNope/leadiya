import { useState, useEffect } from 'react'
import { useToast } from '../hooks/useToast'

export function SettingsView() {
  const { toast } = useToast()
  const [stats, setStats] = useState<{ totalLeads: number; enrichedLeads: number; runningJobs: number } | null>(null)

  useEffect(() => {
    fetch('/api/scrapers/stats')
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => setStats(null))
  }, [])

  return (
    <div className="animate-fade-in space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight premium-gradient-text uppercase">System Overview</h2>
        <p className="text-slate-500 text-sm mt-1 font-medium">Pipeline status and configuration</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-8 rounded-3xl space-y-2">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Leads</span>
          <div className="text-3xl font-black text-brand-400">{stats?.totalLeads?.toLocaleString() ?? '...'}</div>
        </div>
        <div className="glass-card p-8 rounded-3xl space-y-2">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Enriched</span>
          <div className="text-3xl font-black text-emerald-400">{stats?.enrichedLeads?.toLocaleString() ?? '...'}</div>
        </div>
        <div className="glass-card p-8 rounded-3xl space-y-2">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Running Jobs</span>
          <div className="text-3xl font-black text-amber-400">{stats?.runningJobs ?? '...'}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="glass-card p-8 rounded-3xl">
          <h3 className="text-lg font-bold flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-400"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
            Enrichment Sources
          </h3>
          <div className="mt-6 space-y-4">
            {[
              { name: '2GIS name match', desc: 'Cross-enrich non-2GIS leads via search', status: 'active' },
              { name: 'Website Scraper', desc: 'HTTP + Playwright fallback', status: 'active' },
              { name: 'stat.gov.kz', desc: 'Employee count / revenue', status: 'degraded' },
              { name: 'uchet.kz', desc: 'Legal status / OKED', status: 'needs_token' },
              { name: 'goszakup.gov.kz', desc: 'Tender history', status: 'needs_token' },
            ].map((src) => (
              <div key={src.name} className="flex items-center justify-between p-4 bg-slate-950/40 rounded-2xl border border-white/5">
                <div>
                  <div className="text-xs font-bold text-slate-200">{src.name}</div>
                  <div className="text-[10px] text-slate-500">{src.desc}</div>
                </div>
                <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-1 rounded-lg border ${
                  src.status === 'active'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : src.status === 'degraded'
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                      : 'bg-slate-500/10 border-slate-500/20 text-slate-400'
                }`}>
                  {src.status.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card p-8 rounded-3xl">
          <h3 className="text-lg font-bold flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-400"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Quick Actions
          </h3>
          <div className="mt-6 space-y-4">
            <button
              onClick={async () => {
                const url = `/api/companies/export`
                const a = document.createElement('a')
                a.href = url
                a.download = 'all_leads.csv'
                a.click()
                toast('Full export started', 'success')
              }}
              className="w-full p-4 bg-slate-950/40 border border-white/5 rounded-2xl text-xs font-bold text-slate-300 hover:bg-brand-500/10 hover:border-brand-500/20 hover:text-brand-400 transition-all text-left"
            >
              Export all leads to CSV
            </button>
            <button
              onClick={async () => {
                try {
                  const res = await fetch('/api/scrapers/re-enrich', { method: 'POST' })
                  const data = await res.json()
                  if (data.count > 0) {
                    toast(`Queued ${data.count} stale leads for re-enrichment`, 'success')
                  } else {
                    toast('No stale leads found — all enriched within 30 days', 'info')
                  }
                } catch {
                  toast('Failed to trigger re-enrichment', 'error')
                }
              }}
              className="w-full p-4 bg-slate-950/40 border border-white/5 rounded-2xl text-xs font-bold text-slate-300 hover:bg-brand-500/10 hover:border-brand-500/20 hover:text-brand-400 transition-all text-left"
            >
              Re-enrich stale leads (30+ days)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

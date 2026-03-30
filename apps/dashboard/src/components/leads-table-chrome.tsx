import type { MouseEvent } from 'react'
import type { Lead } from '../types'
import { leadStatusLabel } from '../lib/lead-ui'

export function SourceBadge({ source }: { source: string | null }) {
  const normalized = (source || '').toLowerCase()
  let styles = 'bg-slate-500/10 text-slate-400 border-slate-500/20'
  if (normalized === '2gis') styles = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  if (normalized === 'manual') styles = 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'

  return (
    <span className={`px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-widest ${styles}`}>
      {source || 'Неизвестно'}
    </span>
  )
}

export function StatusBadge({ status }: { status: string | null }) {
  const normalized = (status || 'new').toLowerCase()
  let styles = 'bg-slate-500/10 text-slate-400 border-slate-500/20'
  if (normalized === 'valid' || normalized === 'enriched') styles = 'bg-brand-500/10 text-brand-400 border-brand-500/20'
  if (normalized === 'failed') styles = 'bg-rose-500/10 text-rose-400 border-rose-500/20'
  if (normalized === 'archived') styles = 'bg-amber-500/10 text-amber-400 border-amber-500/25'

  return (
    <span className={`px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-widest ${styles}`}>
      {leadStatusLabel(status)}
    </span>
  )
}

export function LeadTableSkeletonRows({ rows }: { rows: number }) {
  const py = 'py-6'
  const avatar = 'h-14 w-14 rounded-2xl'
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} className="animate-pulse" aria-hidden>
          <td className={`px-5 ${py}`}>
            <div className="h-4 w-4 rounded bg-slate-800/90" />
          </td>
          <td className={`px-5 ${py}`}>
            <div className="flex items-center gap-5">
              <div className={`shrink-0 ${avatar} bg-slate-800/90`} />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 max-w-[14rem] rounded bg-slate-800/90" />
                <div className="h-2.5 w-28 rounded bg-slate-800/80" />
              </div>
            </div>
          </td>
          <td className={`px-5 ${py}`}>
            <div className="h-3 w-24 rounded bg-slate-800/90" />
          </td>
          <td className={`px-5 ${py}`}>
            <div className="h-6 w-32 rounded-lg bg-slate-800/90" />
          </td>
          <td className={`px-5 ${py}`}>
            <div className="h-3 w-28 rounded bg-slate-800/90" />
          </td>
          <td className={`px-5 ${py}`}>
            <div className="ml-auto h-8 w-24 rounded-xl bg-slate-800/90" />
          </td>
        </tr>
      ))}
    </>
  )
}

export function LeadReachSummary({ lead }: { lead: Lead }) {
  const stop = (e: MouseEvent) => e.stopPropagation()
  const phone = lead.contacts?.find((c) => c.phone?.trim())?.phone?.trim()
  const email = (lead.email?.trim() || lead.contacts?.find((c) => c.email?.trim())?.email?.trim()) ?? ''
  const wa = lead.whatsapp?.trim()

  const rows: { k: string; v: string; href?: string }[] = []
  if (phone) rows.push({ k: 'Тел', v: phone })
  if (email) rows.push({ k: 'Почта', v: email, href: `mailto:${email}` })
  if (wa) rows.push({ k: 'WA', v: wa.length > 22 ? `${wa.slice(0, 20)}…` : wa })

  if (rows.length === 0) {
    return <span className="text-[10px] text-slate-500">Нет контактов</span>
  }

  return (
    <div className="flex flex-col gap-1 min-w-0 max-w-[220px]">
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline gap-1.5 min-w-0 text-[10px]">
          <span className="shrink-0 font-bold uppercase tracking-wider text-slate-600 w-7">{r.k}</span>
          {r.href ? (
            <a
              href={r.href}
              onClick={stop}
              className="min-w-0 truncate font-mono text-sky-300 hover:text-sky-200 underline decoration-sky-500/40"
            >
              {r.v}
            </a>
          ) : (
            <span className="min-w-0 truncate font-mono text-slate-200">{r.v}</span>
          )}
        </div>
      ))}
    </div>
  )
}

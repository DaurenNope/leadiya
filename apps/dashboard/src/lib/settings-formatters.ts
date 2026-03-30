/** Shared between Settings and other views that show scraper run rows. */

export function formatWhen(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function statusStyles(status: string) {
  const s = status.toLowerCase()
  if (s === 'running') return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
  if (s === 'done' || s === 'completed') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  if (s === 'error' || s === 'failed') return 'bg-rose-500/15 text-rose-300 border-rose-500/30'
  return 'bg-slate-500/15 text-slate-400 border-slate-500/30'
}

export function runStatusLabel(status: string) {
  const s = status.toLowerCase()
  if (s === 'running') return 'выполняется'
  if (s === 'done' || s === 'completed') return 'готово'
  if (s === 'error' || s === 'failed') return 'ошибка'
  if (s === 'cancelled') return 'остановлен'
  return status
}

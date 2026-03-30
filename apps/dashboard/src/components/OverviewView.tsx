import { useCallback, useEffect, useState } from 'react'
import { useExtensionStatus } from '../context/ExtensionStatusContext'
import { apiUrl, authFetch } from '../apiBase'

type Stats = { totalLeads: number; enrichedLeads: number; runningJobs: number }
type WaStatus = { status: string; updatedAt: number | null; qr: string | null; baileysSendEnabled: boolean }
type WaLogRow = {
  id: string; leadId: string | null; channel: string; direction: string
  body: string | null; status: string | null; createdAt: string
  waPeer?: string | null; leadName?: string | null; leadCity?: string | null
}

type OverviewViewProps = {
  onOpenLeads: () => void
  onOpenSettings: () => void
  onOpenScrapers: () => void
  onOpenExtension: () => void
  onOpenCrm: () => void
  onOpenDiscovery: () => void
  onOpenWhatsApp?: () => void
}

function formatNum(n: number) {
  return n.toLocaleString('ru-RU')
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'только что'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} мин назад`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} ч назад`
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

const CARD = 'crm-panel rounded-2xl border border-white/[0.08] p-5 text-left transition-colors hover:border-sky-500/30 hover:bg-slate-900/40'

function IconLeads() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function IconEnriched() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

function IconScraper() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

function IconExtension() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  )
}

function PipelineArrow() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0 text-slate-600">
      <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function OverviewView({
  onOpenLeads,
  onOpenSettings,
  onOpenScrapers,
  onOpenExtension,
  onOpenDiscovery,
  onOpenWhatsApp,
}: OverviewViewProps) {
  const extensionStatus = useExtensionStatus()
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [waStatus, setWaStatus] = useState<WaStatus | null>(null)
  const [recentActivity, setRecentActivity] = useState<WaLogRow[]>([])
  const [activityLoading, setActivityLoading] = useState(true)

  const loadStats = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl('/api/scrapers/stats'))
      if (!res.ok) { setStatsError(`HTTP ${res.status}`); setStats(null); return }
      setStatsError(null)
      setStats(await res.json())
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : 'Ошибка')
      setStats(null)
    }
  }, [])

  const loadWaStatus = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl('/api/outreach/whatsapp/status'))
      if (res.ok) setWaStatus(await res.json())
    } catch { /* ignore */ }
  }, [])

  const loadActivity = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setActivityLoading(true)
    try {
      const res = await authFetch(apiUrl('/api/outreach/log?channel=whatsapp&limit=8'))
      if (res.ok) {
        const data = (await res.json()) as { items?: WaLogRow[] }
        setRecentActivity(data.items ?? [])
      }
    } catch { /* ignore */ }
    finally { if (!opts?.silent) setActivityLoading(false) }
  }, [])

  useEffect(() => {
    void loadStats()
    void loadWaStatus()
    void loadActivity()
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void loadStats()
      void loadWaStatus()
      void loadActivity({ silent: true })
    }, 30_000)
    return () => window.clearInterval(id)
  }, [loadStats, loadWaStatus, loadActivity])

  const extOk = extensionStatus === 'connected'
  const extLabel =
    extensionStatus === 'connected' ? 'Подключено' : extensionStatus === 'checking' ? 'Проверка…' : 'Нет связи'

  return (
    <div className="animate-fade-in space-y-6 pb-16 max-w-5xl">
      {/* Row 1: Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button type="button" onClick={onOpenLeads} className={CARD}>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Лиды в базе</p>
            <IconLeads />
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">
            {statsError ? '—' : stats != null ? formatNum(stats.totalLeads) : '…'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Открыть таблицу →</p>
        </button>

        <button type="button" onClick={onOpenLeads} className={CARD}>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">С обогащением</p>
            <IconEnriched />
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">
            {statsError ? '—' : stats != null ? formatNum(stats.enrichedLeads) : '…'}
          </p>
          <p className="mt-1 text-xs text-slate-500">По данным API</p>
        </button>

        <button type="button" onClick={onOpenScrapers} className={CARD}>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Задачи скрапера</p>
            <IconScraper />
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">
            {statsError ? '—' : stats != null ? formatNum(stats.runningJobs) : '…'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Сейчас в работе</p>
        </button>

        <button type="button" onClick={onOpenExtension} className={CARD}>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Расширение</p>
            <IconExtension />
          </div>
          <p className={`mt-2 text-lg font-semibold ${extOk ? 'text-emerald-400' : 'text-slate-400'}`}>{extLabel}</p>
          <p className="mt-1 text-xs text-slate-500">Мост в этой вкладке</p>
        </button>
      </div>

      {statsError && (
        <p className="text-xs text-rose-400/90" role="status">
          Метрики недоступны: {statsError}
        </p>
      )}

      {/* Row 2: Activity + System Health */}
      <div className="grid gap-4 md:grid-cols-[1fr_320px]">
        {/* Recent Activity */}
        <div className="crm-panel rounded-2xl border border-white/[0.08] p-6">
          <h3 className="text-sm font-semibold text-slate-200">Последняя активность</h3>

          {activityLoading && recentActivity.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500">Загрузка…</p>
          ) : recentActivity.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500">Нет сообщений WhatsApp</p>
          ) : (
            <ul className="mt-4 space-y-1">
              {recentActivity.map((row) => {
                const outbound = row.direction === 'outbound'
                return (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]"
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        outbound
                          ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.4)]'
                          : 'bg-sky-400 shadow-[0_0_4px_rgba(56,189,248,0.4)]'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-slate-200 truncate">
                          {row.leadName || row.waPeer || 'Неизвестный'}
                        </span>
                        <span className={`text-[10px] font-medium uppercase tracking-wide ${outbound ? 'text-emerald-500' : 'text-sky-500'}`}>
                          {outbound ? 'исх' : 'вх'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate">{truncate(row.body, 80) || '(нет текста)'}</p>
                    </div>
                    <span className="text-[11px] text-slate-600 whitespace-nowrap shrink-0">{timeAgo(row.createdAt)}</span>
                  </li>
                )
              })}
            </ul>
          )}

          {onOpenWhatsApp && (
            <button
              type="button"
              onClick={onOpenWhatsApp}
              className="mt-4 text-xs font-medium text-sky-400 hover:text-sky-300 transition-colors"
            >
              Открыть WhatsApp →
            </button>
          )}
        </div>

        {/* System Health */}
        <div className="crm-panel rounded-2xl border border-white/[0.08] p-6 flex flex-col">
          <h3 className="text-sm font-semibold text-slate-200">Состояние системы</h3>
          <ul className="mt-4 space-y-4 flex-1">
            <li className="flex items-start gap-3">
              <span
                className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${
                  waStatus?.status === 'connected'
                    ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                    : waStatus?.status === 'waiting_qr'
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-slate-500'
                }`}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-200">WhatsApp</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {waStatus == null
                    ? 'Загрузка…'
                    : waStatus.status === 'connected'
                      ? 'Подключён' + (waStatus.baileysSendEnabled ? ' · отправка вкл.' : '')
                      : waStatus.status === 'waiting_qr'
                        ? 'Ожидание QR-кода'
                        : 'Отключён'}
                </p>
              </div>
            </li>

            <li className="flex items-start gap-3">
              <span
                className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${
                  stats != null && stats.runningJobs > 0
                    ? 'bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.5)]'
                    : 'bg-sky-400/70'
                }`}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-200">Скрапер</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {statsError
                    ? 'Метрики недоступны'
                    : stats != null
                      ? stats.runningJobs > 0
                        ? `${formatNum(stats.runningJobs)} задач в работе`
                        : 'Нет активных задач'
                      : 'Загрузка…'}
                </p>
              </div>
            </li>

            <li className="flex items-start gap-3">
              <span
                className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${extOk ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-slate-500'}`}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-200">Расширение</p>
                <p className="text-xs text-slate-500 mt-0.5">{extLabel}</p>
              </div>
            </li>
          </ul>

          <div className="mt-5 space-y-2 pt-4 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={onOpenDiscovery}
              className="w-full rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-200 transition-colors hover:bg-sky-500/15"
            >
              Новая задача 2GIS
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="w-full rounded-xl border border-white/[0.08] bg-slate-950/40 px-4 py-2.5 text-sm text-slate-300 transition-colors hover:border-white/15"
            >
              Настройки
            </button>
          </div>
        </div>
      </div>

      {/* Row 3: Pipeline summary */}
      <div className="crm-panel rounded-2xl border border-white/[0.08] p-6">
        <h3 className="text-sm font-semibold text-slate-200 mb-4">Воронка лидов</h3>
        <div className="flex items-center gap-2 overflow-x-auto">
          <div className="flex-1 min-w-[120px] rounded-xl bg-sky-500/10 border border-sky-500/20 p-4 text-center">
            <p className="text-2xl font-semibold tabular-nums text-sky-300">
              {stats != null ? formatNum(stats.totalLeads) : '…'}
            </p>
            <p className="mt-1 text-xs font-medium text-sky-400/80">Всего</p>
          </div>
          <PipelineArrow />
          <div className="flex-1 min-w-[120px] rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4 text-center">
            <p className="text-2xl font-semibold tabular-nums text-emerald-300">
              {stats != null ? formatNum(stats.enrichedLeads) : '…'}
            </p>
            <p className="mt-1 text-xs font-medium text-emerald-400/80">Обогащены</p>
          </div>
          <PipelineArrow />
          <div className="flex-1 min-w-[120px] rounded-xl bg-violet-500/10 border border-violet-500/20 p-4 text-center">
            <p className="text-2xl font-semibold tabular-nums text-violet-300">—</p>
            <p className="mt-1 text-xs font-medium text-violet-400/80">Связались</p>
          </div>
          <PipelineArrow />
          <div className="flex-1 min-w-[120px] rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 text-center">
            <p className="text-2xl font-semibold tabular-nums text-amber-300">—</p>
            <p className="mt-1 text-xs font-medium text-amber-400/80">Ответили</p>
          </div>
        </div>
      </div>
    </div>
  )
}

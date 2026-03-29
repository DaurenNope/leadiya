import { useCallback, useEffect, useState } from 'react'
import { useExtensionStatus } from '../context/ExtensionStatusContext'
import { apiUrl } from '../apiBase'

type Stats = { totalLeads: number; enrichedLeads: number; runningJobs: number }

type OverviewViewProps = {
  onOpenLeads: () => void
  onOpenSettings: () => void
  onOpenScrapers: () => void
  onOpenExtension: () => void
  onOpenCrm: () => void
  onOpenDiscovery: () => void
}

function formatNum(n: number) {
  return n.toLocaleString('ru-RU')
}

export function OverviewView({
  onOpenLeads,
  onOpenSettings,
  onOpenScrapers,
  onOpenExtension,
  onOpenCrm,
  onOpenDiscovery,
}: OverviewViewProps) {
  const extensionStatus = useExtensionStatus()
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/scrapers/stats'))
      if (!res.ok) {
        setStatsError(`HTTP ${res.status}`)
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

  useEffect(() => {
    void loadStats()
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void loadStats()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [loadStats])

  const extOk = extensionStatus === 'connected'
  const extLabel =
    extensionStatus === 'connected' ? 'Подключено' : extensionStatus === 'checking' ? 'Проверка…' : 'Нет связи'

  return (
    <div className="animate-fade-in space-y-8 pb-16 max-w-5xl">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button
          type="button"
          onClick={onOpenLeads}
          className="crm-panel rounded-2xl border border-white/[0.08] p-5 text-left transition-colors hover:border-sky-500/30 hover:bg-slate-900/40"
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Лиды в базе</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">
            {statsError ? '—' : stats != null ? formatNum(stats.totalLeads) : '…'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Открыть таблицу</p>
        </button>

        <div className="crm-panel rounded-2xl border border-white/[0.08] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">С обогащением</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">
            {statsError ? '—' : stats != null ? formatNum(stats.enrichedLeads) : '…'}
          </p>
          <p className="mt-1 text-xs text-slate-500">По данным API</p>
        </div>

        <div className="crm-panel rounded-2xl border border-white/[0.08] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Задачи скрапера</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">
            {statsError ? '—' : stats != null ? formatNum(stats.runningJobs) : '…'}
          </p>
          <p className="mt-1 text-xs text-slate-500">Сейчас в работе</p>
        </div>

        <button
          type="button"
          onClick={onOpenExtension}
          className="crm-panel rounded-2xl border border-white/[0.08] p-5 text-left transition-colors hover:border-sky-500/30 hover:bg-slate-900/40"
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Расширение</p>
          <p className={`mt-2 text-lg font-semibold ${extOk ? 'text-emerald-400' : 'text-slate-400'}`}>{extLabel}</p>
          <p className="mt-1 text-xs text-slate-500">Мост в этой вкладке</p>
        </button>
      </div>

      {statsError && (
        <p className="text-xs text-rose-400/90" role="status">
          Метрики недоступны: {statsError}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="crm-panel rounded-2xl border border-white/[0.08] p-6">
          <h3 className="text-sm font-semibold text-slate-200">Быстрые действия</h3>
          <ul className="mt-4 space-y-2">
            <li>
              <button
                type="button"
                onClick={onOpenDiscovery}
                className="w-full rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-left text-sm font-medium text-sky-200 transition-colors hover:bg-sky-500/15"
              >
                Новая задача 2GIS
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={onOpenLeads}
                className="w-full rounded-xl border border-white/[0.08] bg-slate-950/40 px-4 py-3 text-left text-sm text-slate-200 transition-colors hover:border-white/15"
              >
                Список лидов
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={onOpenCrm}
                className="w-full rounded-xl border border-white/[0.08] bg-slate-950/40 px-4 py-3 text-left text-sm text-slate-200 transition-colors hover:border-white/15"
              >
                CRM и рассылки
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={onOpenScrapers}
                className="w-full rounded-xl border border-white/[0.08] bg-slate-950/40 px-4 py-3 text-left text-sm text-slate-200 transition-colors hover:border-white/15"
              >
                История задач 2GIS
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={onOpenSettings}
                className="w-full rounded-xl border border-white/[0.08] bg-slate-950/40 px-4 py-3 text-left text-sm text-slate-200 transition-colors hover:border-white/15"
              >
                Настройки и проверка API
              </button>
            </li>
          </ul>
        </div>

        <div className="crm-panel rounded-2xl border border-white/[0.08] p-6">
          <h3 className="text-sm font-semibold text-slate-200">Новости и обновления</h3>
          <ul className="mt-4 space-y-4 text-sm text-slate-400">
            <li className="border-l-2 border-sky-500/40 pl-4">
              <p className="font-medium text-slate-300">Интерфейс</p>
              <p className="mt-1 text-xs leading-relaxed">
                Главный экран с метриками, таблица лидов упрощена: детали карточки 2GIS, сайт и ICP — в боковой панели по клику на строку.
              </p>
            </li>
            <li className="border-l-2 border-white/10 pl-4">
              <p className="font-medium text-slate-300">Расширение</p>
              <p className="mt-1 text-xs leading-relaxed">
                Связь с дашбордом через postMessage в этой вкладке; статус виден в блоке «Расширение» и на этом экране.
              </p>
            </li>
            <li className="border-l-2 border-white/10 pl-4">
              <p className="font-medium text-slate-300">Дальше</p>
              <p className="mt-1 text-xs leading-relaxed">
                Сюда можно подключить ленту релизов или внутренние заметки команды — пока статический блок-заглушка.
              </p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

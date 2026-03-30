import { useEffect, useState, useCallback, useRef } from 'react'
import { apiUrl, authFetch } from '../apiBase'
import { useToast } from '../hooks/useToast'

export type ScraperRunRow = {
  id: string
  scraper: string
  status: string
  resultsCount: string | null
  detailAttempts?: number | null
  totalSkipped?: number | null
  listPagesCompleted?: number | null
  emptyPageStreakMax?: number | null
  currentSlice?: string | null
  totalSlices?: number | null
  completedSlices?: number | null
  /** Server heartbeat: list page start, stat bumps, new lead saved (ISO). */
  lastProgressAt?: string | null
  error: string | null
  startedAt: string | null
  completedAt: string | null
}

function pollErrorMessage(status: number): string {
  if (status === 404) return 'Запуск не найден (неверный id или строка удалена).'
  if (status === 502 || status === 503 || status === 504) {
    return `Шлюз (${status}) — прокси дашборда не достучался до API. В .env в корне задайте LEADIYA_API_ORIGIN на тот же хост/порт, что у Hono (dev-ports.json → localCliApiPort), перезапустите Vite и убедитесь, что API запущен.`
  }
  if (status === 401) return '401 — API отклонил запрос (для локалки: AUTH_BYPASS=true или валидный Bearer).'
  return `HTTP ${status} — не удалось загрузить статус запуска.`
}

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return '—'
  const t = new Date(startedAt).getTime()
  if (Number.isNaN(t)) return '—'
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 60) return `${sec} с`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m} мин ${sec % 60} с`
  const h = Math.floor(m / 60)
  return `${h} ч ${m % 60} мин`
}

/** Elapsed minutes from start to end (or now). Minimum ~1s to avoid huge spikes at t=0. */
function elapsedMinutes(startIso: string | null, endIso?: string | null): number | null {
  if (!startIso) return null
  const t0 = new Date(startIso).getTime()
  if (Number.isNaN(t0)) return null
  const t1 = endIso ? new Date(endIso).getTime() : Date.now()
  if (Number.isNaN(t1)) return null
  const sec = Math.max(0, (t1 - t0) / 1000)
  return Math.max(sec / 60, 1 / 60)
}

function formatPerMinute(rate: number): string {
  if (!Number.isFinite(rate) || rate < 0) return '—'
  if (rate < 0.05) return rate.toFixed(2)
  if (rate < 10) return rate.toFixed(1)
  return String(Math.round(rate))
}

/** Minutes since ISO timestamp, or null if invalid. */
function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, (Date.now() - t) / 60_000)
}

function formatMinutesAgo(mins: number | null): string {
  if (mins == null || !Number.isFinite(mins)) return '—'
  if (mins < 1) return '<1 мин'
  if (mins < 60) return `${Math.floor(mins)} мин`
  const h = Math.floor(mins / 60)
  const m = Math.floor(mins % 60)
  return `${h} ч ${m} мин`
}

type Props = {
  runId: string
  onDismiss: () => void
  onRunFinished?: (outcome: 'done' | 'error') => void
  onOpenLeadList?: () => void
  onOpenScrapers?: () => void
}

export function ScraperRunBanner({ runId, onDismiss, onRunFinished, onOpenLeadList, onOpenScrapers }: Props) {
  const { toast } = useToast()
  const [run, setRun] = useState<ScraperRunRow | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [stopBusy, setStopBusy] = useState(false)
  const [rateTick, setRateTick] = useState(0)
  const finishedNotified = useRef(false)
  /** When live counters last changed — detects "stuck" without server last_progress_at (pre-migration). */
  const countersQuietSince = useRef<{ key: string; at: number } | null>(null)

  const poll = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl(`/api/scrapers/runs/${runId}`))
      if (!res.ok) {
        setFetchError(pollErrorMessage(res.status))
        return
      }
      setFetchError(null)
      const row = (await res.json()) as ScraperRunRow
      setRun(row)
    } catch (e) {
      setFetchError(
        e instanceof Error
          ? e.message
          : 'Сеть: API недоступен. Проверьте Hono и LEADIYA_API_ORIGIN.',
      )
    }
  }, [runId])

  useEffect(() => {
    finishedNotified.current = false
    countersQuietSince.current = null
  }, [runId])

  useEffect(() => {
    void poll()
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void poll()
    }, 1500)
    return () => window.clearInterval(id)
  }, [poll])

  /** Recompute saved/min and attempts/min every second while a run is active (poll is ~1.5s). */
  useEffect(() => {
    const s = (run?.status ?? '').toLowerCase()
    if (s !== 'running') return
    const id = window.setInterval(() => setRateTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [run?.status])

  useEffect(() => {
    if (!run || finishedNotified.current) return
    const s = run.status.toLowerCase()
    if (s === 'done' || s === 'completed' || s === 'error' || s === 'failed') {
      finishedNotified.current = true
      onRunFinished?.(s === 'error' || s === 'failed' ? 'error' : 'done')
    }
  }, [run, onRunFinished])

  const status = (run?.status ?? '…').toLowerCase()
  const isRunning = status === 'running'
  const isDone = status === 'done' || status === 'completed'
  const isCancelled = status === 'cancelled'
  const isError = status === 'error' || status === 'failed'

  const savedCount = Number.parseInt(run?.resultsCount ?? '0', 10) || 0
  const attemptsCount = run?.detailAttempts ?? 0
  const minsRunning = elapsedMinutes(run?.startedAt ?? null, null)
  const minsFinished = elapsedMinutes(run?.startedAt ?? null, run?.completedAt ?? null)
  void rateTick
  const savedPerMinRunning =
    minsRunning != null ? formatPerMinute(savedCount / minsRunning) : '—'
  const attemptsPerMinRunning =
    minsRunning != null ? formatPerMinute(attemptsCount / minsRunning) : '—'
  const savedPerMinDone =
    minsFinished != null ? formatPerMinute(savedCount / minsFinished) : '—'

  const progressKey = run
    ? `${run.resultsCount ?? ''}|${run.detailAttempts ?? 0}|${run.totalSkipped ?? 0}|${run.listPagesCompleted ?? 0}|${run.emptyPageStreakMax ?? 0}`
    : ''
  if (isRunning && progressKey) {
    const prev = countersQuietSince.current
    if (!prev || prev.key !== progressKey) {
      countersQuietSince.current = { key: progressKey, at: Date.now() }
    }
  }
  const quietMinutes =
    isRunning && countersQuietSince.current
      ? (Date.now() - countersQuietSince.current.at) / 60_000
      : 0
  const serverProgressMin = minutesSince(run?.lastProgressAt ?? null)
  const showStaleHint =
    isRunning &&
    quietMinutes >= 6 &&
    (serverProgressMin == null || serverProgressMin >= 6)

  const stopRun = async () => {
    setStopBusy(true)
    try {
      const res = await authFetch(apiUrl(`/api/scrapers/runs/${runId}/cancel`), { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      if (res.status === 409) {
        toast(data.error || 'Запуск уже не в состоянии running', 'info')
        void poll()
        return
      }
      if (!res.ok) throw new Error(data.error || `Остановка не удалась (${res.status})`)
      toast('Остановка запрошена: текущий срез доработается, затем запуск остановится.', 'success')
      void poll()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось остановить запуск', 'error')
    } finally {
      setStopBusy(false)
    }
  }

  return (
    <div
      className={`rounded-2xl border px-5 py-4 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 ${
        isError
          ? 'border-rose-500/30 bg-rose-950/40'
          : isCancelled
            ? 'border-slate-500/35 bg-slate-900/50'
            : isDone
              ? 'border-emerald-500/25 bg-emerald-950/30'
              : 'border-amber-500/25 bg-amber-950/20'
      }`}
    >
      <div className="min-w-0 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${
              isRunning
                ? 'border-amber-500/40 text-amber-300 bg-amber-500/10'
                : isDone
                  ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                  : isCancelled
                    ? 'border-slate-500/40 text-slate-300 bg-slate-500/10'
                    : isError
                      ? 'border-rose-500/40 text-rose-300 bg-rose-500/10'
                      : 'border-slate-500/40 text-slate-400'
            }`}
          >
            2GIS{' '}
            {isRunning ? 'идёт' : isDone ? 'готово' : isCancelled ? 'остановлен' : isError ? 'ошибка' : run?.status ?? '…'}
          </span>
          <span className="text-[10px] text-slate-500 font-mono truncate max-w-[min(100%,280px)]" title={runId}>
            {runId.slice(0, 8)}…
          </span>
        </div>
        <div className="text-sm text-slate-200 leading-relaxed">
          {fetchError ? (
            <p className="text-rose-300">{fetchError}</p>
          ) : isRunning ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/[0.07] bg-slate-950/50 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-2xl font-semibold tabular-nums text-white">{run?.resultsCount ?? '0'}</span>
                  <span className="text-sm text-slate-400">новых</span>
                  <span className="text-slate-600 hidden sm:inline">·</span>
                  <span className="text-sm tabular-nums text-slate-300">{formatElapsed(run?.startedAt ?? null)}</span>
                </div>
                <p className="text-[13px] text-slate-500 mt-2 leading-snug">
                  <span className="text-slate-400 tabular-nums">{run?.detailAttempts ?? 0}</span> карточек ·{' '}
                  <span className="text-slate-400 tabular-nums">{run?.totalSkipped ?? 0}</span> дублей ·{' '}
                  <span className="tabular-nums">{savedPerMinRunning}</span> нов/мин ·{' '}
                  <span className="tabular-nums">{attemptsPerMinRunning}</span> карт/мин
                </p>
                {(run?.currentSlice || run?.totalSlices) ? (
                  <p className="text-[12px] text-slate-500 mt-1.5 leading-snug">
                    Сейчас:{' '}
                    <span className="text-amber-300/80">
                      {run.currentSlice ?? '…'}
                    </span>
                    {run.totalSlices ? (
                      <span className="text-slate-500">
                        {' '}(<span className="text-slate-300 tabular-nums">{(run.completedSlices ?? 0) + 1}</span>
                        {' '}из <span className="text-slate-300 tabular-nums">{run.totalSlices}</span>)
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <p className="text-[11px] text-slate-500 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    Прогресс (сервер):{' '}
                    <span className="text-slate-300 tabular-nums">
                      {run?.lastProgressAt ? formatMinutesAgo(serverProgressMin) + ' назад' : 'нет метки — выполните db:migrate'}
                    </span>
                  </span>
                </p>
                {showStaleHint ? (
                  <div
                    className="rounded-lg border border-amber-500/35 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-100/95 leading-snug"
                    role="status"
                  >
                    <strong className="text-amber-200">Похоже на зависание:</strong> счётчики и метка прогресса не обновлялись{' '}
                    {Math.floor(Math.max(quietMinutes, serverProgressMin ?? 0))}+ мин. Проверьте лог процесса API (2GIS), прокси и капчу. Воркеры
                    помечают такой запуск ошибкой через <code className="text-amber-200/90">SCRAPER_RUN_NO_PROGRESS_MINUTES</code> (по умолчанию 30
                    мин) или остановите вручную.
                  </div>
                ) : null}
              </div>
              <details className="text-[11px] text-slate-500">
                <summary className="cursor-pointer text-slate-500 hover:text-slate-400">
                  Зачем так и что делать, если цифры не растут
                </summary>
                <div className="mt-2 text-slate-500 space-y-1.5 border-l border-white/10 pl-3">
                  <p>
                    Статус <strong className="text-slate-400">готово</strong> — когда отработаны все срезы города×категории. «Новых» — только
                    вставки в БД; дубликаты по URL не увеличивают этот счётчик.
                  </p>
                  <p>
                    Поиск 2GIS идёт по страницам; срез заканчивается после нескольких пустых страниц подряд. Долгое плато без движения карточек/дублей
                    часто значит <strong className="text-slate-400">зависший запрос</strong> (капча, прокси, блокировка) — смотрите лог API. Поле{' '}
                    <code className="text-slate-400">last_progress_at</code> обновляется на каждой странице списка и при сохранении — если оно старше
                    порога, фоновый watchdog в <strong className="text-slate-400">workers</strong> закроет запуск.
                  </p>
                  <p>
                    <code className="text-slate-400">results_count bump failed</code> — редкий сбой счётчика; лид мог сохраниться.
                  </p>
                </div>
              </details>
            </div>
          ) : isDone ? (
            <p>
              Готово. Всего записей за запуск:{' '}
              <span className="text-emerald-300 font-bold tabular-nums">{run?.resultsCount ?? '0'}</span>
              {run?.startedAt && run?.completedAt ? (
                <span className="text-slate-400 font-normal text-xs">
                  {' '}
                  · в среднем сохр./мин:{' '}
                  <span className="text-slate-200 tabular-nums">{savedPerMinDone}</span>
                </span>
              ) : null}
              {run?.completedAt ? (
                <span className="text-slate-500 font-normal text-xs"> · {new Date(run.completedAt).toLocaleString('ru-RU')}</span>
              ) : null}
            </p>
          ) : isCancelled ? (
            <span className="text-slate-300">
              Запуск остановлен из дашборда. Если срез ещё выполнялся, итог может остаться{' '}
              <span className="tabular-nums text-white">{run?.resultsCount ?? '0'}</span> до завершения работы на сервере.
            </span>
          ) : isError ? (
            <span className="text-rose-200">{run?.error || 'Неизвестная ошибка'}</span>
          ) : (
            <p className="text-slate-400">Загрузка статуса…</p>
          )}
        </div>
        <p className="text-[11px] text-slate-500 leading-snug">
          <strong className="text-slate-400">Скрыть</strong> — только баннер. <strong className="text-slate-300">Остановить</strong> — отмена запуска.
          {onOpenScrapers ? (
            <>
              {' '}
              <button type="button" onClick={onOpenScrapers} className="text-emerald-400/90 hover:text-emerald-300 underline underline-offset-2">
                Задачи 2GIS
              </button>
              {' · '}
            </>
          ) : null}
          <span className="text-slate-600">CRM — меню «Работа с лидами»</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {isRunning ? (
          <button
            type="button"
            disabled={stopBusy}
            onClick={() => void stopRun()}
            className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50 transition-colors"
          >
            {stopBusy ? 'Остановка…' : 'Остановить'}
          </button>
        ) : null}
        {onOpenLeadList ? (
          <button
            type="button"
            onClick={onOpenLeadList}
            className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
          >
            Список лидов
          </button>
        ) : null}
        {isDone ? (
          <span className="text-[10px] font-medium text-emerald-400/85">Обновите список лидов, если нужно.</span>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          Скрыть
        </button>
      </div>
    </div>
  )
}

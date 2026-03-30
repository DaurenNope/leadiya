import { useState, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useToast } from '../hooks/useToast'
import { useExtensionStatus } from '../context/ExtensionStatusContext'
import { apiUrl, authFetch, apiOriginLabel, apiReachabilityUrl } from '../apiBase'
import type { ScraperRunRow } from './ScraperRunBanner'
import { WhatsAppConnectPanel } from './WhatsAppConnectPanel'

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Shared UI atoms                                                   */
/* ------------------------------------------------------------------ */

const inputCls =
  'bg-slate-900/80 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500/40 focus:ring-1 focus:ring-sky-500/20 transition-colors w-full'

const labelCls = 'text-[13px] font-medium text-slate-300'
const sectionTitleCls = 'text-base font-semibold text-slate-100'
const helpCls = 'text-xs text-slate-500'
const saveBtnCls =
  'px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${value ? 'bg-sky-500' : 'bg-slate-700'}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transform transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  )
}

function FieldRow({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="sm:w-56 shrink-0">
        <label className={labelCls}>{label}</label>
        {help && <p className={helpCls}>{help}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function TagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('')

  const addTag = () => {
    const trimmed = input.trim()
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed])
    }
    setInput('')
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    }
    if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-lg bg-sky-500/15 border border-sky-500/30 text-[13px] text-sky-200"
          >
            {t}
            <button
              type="button"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="hover:text-rose-300 transition-colors text-sky-400"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          className={inputCls}
        />
        <button type="button" onClick={addTag} className="px-4 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-sm text-slate-300 hover:bg-slate-700 transition-colors shrink-0">
          +
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                              */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'connections', label: 'Подключения' },
  { id: 'automation', label: 'Автоматизация' },
  { id: 'discovery', label: 'Сбор данных' },
  { id: 'company', label: 'Компания' },
  { id: 'data', label: 'Данные' },
] as const

type TabId = (typeof TABS)[number]['id']

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface AutomationSettings {
  max_outreach_per_day: number
  max_outreach_per_hour: number
  delay_min_ms: number
  delay_max_ms: number
  max_followups_per_lead: number
  cooldown_after_response: boolean
  typing_simulation: boolean
  business_hours: {
    enabled: boolean
    start: number
    end: number
    timezone: string
  }
  warmup: {
    enabled: boolean
    day1_limit: number
    ramp_per_day: number
    max_daily: number
  }
}

interface CompanySettings {
  name: string
  name_ru: string
  tagline: string
  tagline_ru: string
  website: string
  calendar_url: string
  whatsapp: string
}

const DEFAULT_AUTOMATION: AutomationSettings = {
  max_outreach_per_day: 30,
  max_outreach_per_hour: 10,
  delay_min_ms: 35000,
  delay_max_ms: 90000,
  max_followups_per_lead: 3,
  cooldown_after_response: true,
  typing_simulation: true,
  business_hours: { enabled: true, start: 9, end: 19, timezone: 'Asia/Almaty' },
  warmup: { enabled: true, day1_limit: 5, ramp_per_day: 3, max_daily: 30 },
}

const DEFAULT_COMPANY: CompanySettings = {
  name: '',
  name_ru: '',
  tagline: '',
  tagline_ru: '',
  website: '',
  calendar_url: '',
  whatsapp: '',
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export function SettingsView() {
  const { toast } = useToast()
  const extensionStatus = useExtensionStatus()
  const [activeTab, setActiveTab] = useState<TabId>('connections')

  /* ---- Connections tab state ---- */
  const [pinging, setPinging] = useState(false)
  const [lastPing, setLastPing] = useState<{ ok: boolean; ms: number; detail: string } | null>(null)
  const [capabilities, setCapabilities] = useState<{
    agentBridge: { configured: boolean; headerName: string }
    auth: { bypass: boolean }
    integrations: Record<string, boolean>
  } | null>(null)
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null)

  /* ---- Data tab state ---- */
  const [stats, setStats] = useState<{ totalLeads: number; enrichedLeads: number; runningJobs: number } | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [runs, setRuns] = useState<ScraperRunRow[]>([])
  const [runsError, setRunsError] = useState<string | null>(null)

  /* ---- Automation tab state ---- */
  const [automation, setAutomation] = useState<AutomationSettings>(DEFAULT_AUTOMATION)
  const [automationLoading, setAutomationLoading] = useState(false)
  const [automationSaving, setAutomationSaving] = useState(false)

  /* ---- Discovery tab state ---- */
  const [cities, setCities] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [discoveryLoading, setDiscoveryLoading] = useState(false)
  const [discoverySaving, setDiscoverySaving] = useState(false)

  /* ---- Company tab state ---- */
  const [company, setCompany] = useState<CompanySettings>(DEFAULT_COMPANY)
  const [companyLoading, setCompanyLoading] = useState(false)
  const [companySaving, setCompanySaving] = useState(false)

  /* ================================================================ */
  /*  Data loaders                                                    */
  /* ================================================================ */

  const loadStats = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl('/api/scrapers/stats'))
      if (!res.ok) { setStatsError(`Статистика: HTTP ${res.status}`); setStats(null); return }
      setStatsError(null)
      setStats(await res.json())
    } catch (e) {
      setStatsError(e instanceof Error ? e.message : 'Ошибка'); setStats(null)
    }
  }, [])

  const loadRuns = useCallback(async (opts?: { bustCache?: boolean }) => {
    try {
      const q = new URLSearchParams({ limit: '25', scraper: '2gis' })
      if (opts?.bustCache) q.set('nocache', '1')
      const res = await authFetch(apiUrl(`/api/scrapers/runs?${q.toString()}`))
      if (!res.ok) { setRunsError(`Запуски: HTTP ${res.status}`); setRuns([]); return }
      setRunsError(null)
      const data = (await res.json()) as { runs?: ScraperRunRow[] }
      setRuns(data.runs ?? [])
    } catch (e) {
      setRunsError(e instanceof Error ? e.message : 'Ошибка'); setRuns([])
    }
  }, [])

  const loadCapabilities = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl('/api/system/capabilities'))
      if (!res.ok) { setCapabilitiesError(`Возможности: HTTP ${res.status}`); setCapabilities(null); return }
      setCapabilitiesError(null)
      setCapabilities(await res.json())
    } catch (e) {
      setCapabilitiesError(e instanceof Error ? e.message : 'Ошибка'); setCapabilities(null)
    }
  }, [])

  const loadAutomation = useCallback(async () => {
    setAutomationLoading(true)
    try {
      const res = await authFetch(apiUrl('/api/settings/automation'))
      if (res.ok) {
        const data = (await res.json()) as { automation?: Partial<AutomationSettings> }
        const a = data.automation ?? {}
        setAutomation({
          ...DEFAULT_AUTOMATION,
          ...a,
          business_hours: { ...DEFAULT_AUTOMATION.business_hours, ...(a.business_hours ?? {}) },
          warmup: { ...DEFAULT_AUTOMATION.warmup, ...(a.warmup ?? {}) },
        })
      }
    } catch { /* keep defaults */ }
    setAutomationLoading(false)
  }, [])

  const loadDiscovery = useCallback(async () => {
    setDiscoveryLoading(true)
    try {
      const res = await authFetch(apiUrl('/api/settings/discovery'))
      if (res.ok) {
        const data = (await res.json()) as { cities?: string[]; categories?: string[] }
        setCities(data.cities ?? [])
        setCategories(data.categories ?? [])
      }
    } catch { /* keep defaults */ }
    setDiscoveryLoading(false)
  }, [])

  const loadCompany = useCallback(async () => {
    setCompanyLoading(true)
    try {
      const res = await authFetch(apiUrl('/api/settings/company'))
      if (res.ok) {
        const data = (await res.json()) as { company?: Partial<CompanySettings> }
        setCompany({ ...DEFAULT_COMPANY, ...(data.company ?? {}) })
      }
    } catch { /* keep defaults */ }
    setCompanyLoading(false)
  }, [])

  /* ================================================================ */
  /*  Save handlers                                                   */
  /* ================================================================ */

  const saveAutomation = async () => {
    setAutomationSaving(true)
    try {
      const res = await authFetch(apiUrl('/api/settings/automation'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(automation),
      })
      if (res.ok) toast('Настройки автоматизации сохранены', 'success')
      else toast(`Ошибка сохранения: HTTP ${res.status}`, 'error')
    } catch {
      toast('Не удалось сохранить настройки', 'error')
    }
    setAutomationSaving(false)
  }

  const saveDiscovery = async () => {
    setDiscoverySaving(true)
    try {
      const res = await authFetch(apiUrl('/api/settings/discovery'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cities, categories }),
      })
      if (res.ok) toast('Настройки сбора данных сохранены', 'success')
      else toast(`Ошибка сохранения: HTTP ${res.status}`, 'error')
    } catch {
      toast('Не удалось сохранить настройки', 'error')
    }
    setDiscoverySaving(false)
  }

  const saveCompany = async () => {
    setCompanySaving(true)
    try {
      const res = await authFetch(apiUrl('/api/settings/company'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(company),
      })
      if (res.ok) toast('Данные компании сохранены', 'success')
      else toast(`Ошибка сохранения: HTTP ${res.status}`, 'error')
    } catch {
      toast('Не удалось сохранить данные компании', 'error')
    }
    setCompanySaving(false)
  }

  /* ================================================================ */
  /*  Effects                                                         */
  /* ================================================================ */

  useEffect(() => {
    void loadStats()
    void loadRuns({ bustCache: true })
    void loadCapabilities()
    void loadAutomation()
    void loadDiscovery()
    void loadCompany()
  }, [loadStats, loadRuns, loadCapabilities, loadAutomation, loadDiscovery, loadCompany])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void loadStats()
      void loadRuns()
    }, 12_000)
    return () => window.clearInterval(id)
  }, [loadStats, loadRuns])

  /* ================================================================ */
  /*  Connection test                                                 */
  /* ================================================================ */

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
          const j = (await res.json()) as { status?: string; service?: string; healthy?: boolean }
          if (j.status) detail = j.status
          if (j.service === 'leadiya-api') detail = `${j.status ?? 'ok'} · Leadiya API`
          const wrongService =
            res.ok && j.service !== 'leadiya-api' && (j.healthy === true || (j.status !== 'ok' && j.status !== undefined))
          if (wrongService) {
            setLastPing({ ok: false, ms, detail: 'not-leadiya-api' })
            toast(
              '/health ответил, но это не API Leadiya (ожидается service: leadiya-api). Возможно, порт занят другим приложением.',
              'error',
            )
            return
          }
        } catch { /* ignore */ }
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

  /* ================================================================ */
  /*  Automation field updaters                                       */
  /* ================================================================ */

  const setAuto = <K extends keyof AutomationSettings>(k: K, v: AutomationSettings[K]) =>
    setAutomation((prev) => ({ ...prev, [k]: v }))

  const setBH = <K extends keyof AutomationSettings['business_hours']>(k: K, v: AutomationSettings['business_hours'][K]) =>
    setAutomation((prev) => ({ ...prev, business_hours: { ...prev.business_hours, [k]: v } }))

  const setWU = <K extends keyof AutomationSettings['warmup']>(k: K, v: AutomationSettings['warmup'][K]) =>
    setAutomation((prev) => ({ ...prev, warmup: { ...prev.warmup, [k]: v } }))

  const setComp = <K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) =>
    setCompany((prev) => ({ ...prev, [k]: v }))

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  return (
    <div className="animate-fade-in space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-white">Настройки</h2>
        <p className="text-slate-500 text-sm mt-1">Подключения, автоматизация, параметры сбора и данные компании</p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-slate-900/50 rounded-xl border border-white/5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-sky-500/15 text-sky-200 border border-sky-500/30'
                : 'text-slate-400 border border-transparent hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ============================================================ */}
      {/*  TAB 1: Подключения                                          */}
      {/* ============================================================ */}
      {activeTab === 'connections' && (
        <div className="space-y-6">
          {/* API Connection */}
          <div className="crm-panel p-6 rounded-2xl space-y-4">
            <h3 className={sectionTitleCls}>Подключение к API</h3>
            <p className="text-[13px] text-slate-500 leading-relaxed">{apiOriginLabel()}</p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={pinging}
                onClick={() => void testConnection()}
                className="px-4 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-[13px] font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {pinging ? 'Проверка…' : 'Проверить соединение'}
              </button>
              {lastPing && (
                <span className={`text-[13px] font-semibold ${lastPing.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {lastPing.ok ? 'ОК' : 'Сбой'} · {lastPing.ms} мс · {lastPing.detail}
                </span>
              )}
            </div>
            {statsError && <p className="text-[13px] text-rose-400">{statsError}</p>}
          </div>

          {/* Chrome extension */}
          <div className="crm-panel p-6 rounded-2xl space-y-4">
            <h3 className={sectionTitleCls}>Расширение Chrome</h3>
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

          {/* WhatsApp (Baileys) */}
          <div className="crm-panel p-6 rounded-2xl space-y-1">
            <h3 className={sectionTitleCls + ' mb-3'}>WhatsApp (Baileys)</h3>
            <WhatsAppConnectPanel />
          </div>

          {/* Hermes */}
          <div className="crm-panel p-6 rounded-2xl space-y-4">
            <h3 className={sectionTitleCls}>Мост агента (Hermes)</h3>
            <p className="text-[13px] text-slate-500 leading-relaxed">
              Hermes вызывает REST API с заголовком{' '}
              <code className="text-slate-400">{capabilities?.agentBridge.headerName ?? 'X-Leadiya-Service-Key'}</code>.
            </p>
            {capabilitiesError && <p className="text-[13px] text-rose-400">{capabilitiesError}</p>}
            {capabilities && (
              <div className="flex flex-wrap gap-3">
                <div
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${
                    capabilities.agentBridge.configured
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${capabilities.agentBridge.configured ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  {capabilities.agentBridge.configured ? 'Ключ агента задан' : 'Ключ агента не задан'}
                </div>
                {capabilities.auth.bypass && (
                  <span className="inline-flex items-center px-3 py-2 rounded-lg border border-slate-500/30 bg-slate-950/50 text-[13px] text-slate-400">
                    AUTH_BYPASS (dev)
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/*  TAB 2: Автоматизация                                        */}
      {/* ============================================================ */}
      {activeTab === 'automation' && (
        <div className="space-y-6">
          {automationLoading ? (
            <div className="crm-panel p-8 rounded-2xl text-center text-slate-500 text-sm">Загрузка…</div>
          ) : (
            <>
              {/* Лимиты отправки */}
              <div className="crm-panel p-6 rounded-2xl space-y-5">
                <h3 className={sectionTitleCls}>Лимиты отправки</h3>
                <div className="space-y-4">
                  <FieldRow label="В день" help="Максимум сообщений за 24 ч">
                    <input
                      type="number"
                      min={1}
                      value={automation.max_outreach_per_day}
                      onChange={(e) => setAuto('max_outreach_per_day', Number(e.target.value))}
                      className={inputCls}
                    />
                  </FieldRow>
                  <FieldRow label="В час" help="Максимум сообщений за 1 час">
                    <input
                      type="number"
                      min={1}
                      value={automation.max_outreach_per_hour}
                      onChange={(e) => setAuto('max_outreach_per_hour', Number(e.target.value))}
                      className={inputCls}
                    />
                  </FieldRow>
                  <FieldRow label="Фоллоу-апов на лид" help="Повторных сообщений одному контакту">
                    <input
                      type="number"
                      min={0}
                      value={automation.max_followups_per_lead}
                      onChange={(e) => setAuto('max_followups_per_lead', Number(e.target.value))}
                      className={inputCls}
                    />
                  </FieldRow>
                </div>
              </div>

              {/* Задержки и антибан */}
              <div className="crm-panel p-6 rounded-2xl space-y-5">
                <h3 className={sectionTitleCls}>Задержки и антибан</h3>
                <div className="space-y-4">
                  <FieldRow label="Мин. задержка (сек)" help="Между сообщениями">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={Math.round(automation.delay_min_ms / 1000)}
                      onChange={(e) => setAuto('delay_min_ms', Number(e.target.value) * 1000)}
                      className={inputCls}
                    />
                  </FieldRow>
                  <FieldRow label="Макс. задержка (сек)">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={Math.round(automation.delay_max_ms / 1000)}
                      onChange={(e) => setAuto('delay_max_ms', Number(e.target.value) * 1000)}
                      className={inputCls}
                    />
                  </FieldRow>
                  <FieldRow label="Пауза после ответа" help="Прекратить рассылку контакту, если он ответил">
                    <Toggle value={automation.cooldown_after_response} onChange={(v) => setAuto('cooldown_after_response', v)} />
                  </FieldRow>
                  <FieldRow label="Имитация набора" help="Показать «печатает…» перед отправкой">
                    <Toggle value={automation.typing_simulation} onChange={(v) => setAuto('typing_simulation', v)} />
                  </FieldRow>
                </div>
              </div>

              {/* Рабочие часы */}
              <div className="crm-panel p-6 rounded-2xl space-y-5">
                <h3 className={sectionTitleCls}>Рабочие часы</h3>
                <div className="space-y-4">
                  <FieldRow label="Включено">
                    <Toggle value={automation.business_hours.enabled} onChange={(v) => setBH('enabled', v)} />
                  </FieldRow>
                  <FieldRow label="Начало (час)" help="0–23">
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={automation.business_hours.start}
                      onChange={(e) => setBH('start', Number(e.target.value))}
                      className={inputCls}
                    />
                  </FieldRow>
                  <FieldRow label="Конец (час)" help="0–23">
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={automation.business_hours.end}
                      onChange={(e) => setBH('end', Number(e.target.value))}
                      className={inputCls}
                    />
                  </FieldRow>
                  <FieldRow label="Часовой пояс">
                    <input
                      type="text"
                      value={automation.business_hours.timezone}
                      onChange={(e) => setBH('timezone', e.target.value)}
                      placeholder="Asia/Almaty"
                      className={inputCls}
                    />
                  </FieldRow>
                </div>
              </div>

              {/* Прогрев аккаунта */}
              <div className="crm-panel p-6 rounded-2xl space-y-5">
                <h3 className={sectionTitleCls}>Прогрев аккаунта</h3>
                <div className="space-y-4">
                  <FieldRow label="Включено">
                    <Toggle value={automation.warmup.enabled} onChange={(v) => setWU('enabled', v)} />
                  </FieldRow>
                  <FieldRow label="Лимит 1-го дня">
                    <input
                      type="number"
                      min={1}
                      value={automation.warmup.day1_limit}
                      onChange={(e) => setWU('day1_limit', Number(e.target.value))}
                      className={inputCls}
                    />
                  </FieldRow>
                  <FieldRow label="Прирост в день">
                    <input
                      type="number"
                      min={1}
                      value={automation.warmup.ramp_per_day}
                      onChange={(e) => setWU('ramp_per_day', Number(e.target.value))}
                      className={inputCls}
                    />
                  </FieldRow>
                  <FieldRow label="Макс. в день" help="Потолок после прогрева">
                    <input
                      type="number"
                      min={1}
                      value={automation.warmup.max_daily}
                      onChange={(e) => setWU('max_daily', Number(e.target.value))}
                      className={inputCls}
                    />
                  </FieldRow>
                </div>
              </div>

              {/* Save */}
              <div className="flex justify-end">
                <button type="button" disabled={automationSaving} onClick={() => void saveAutomation()} className={saveBtnCls}>
                  {automationSaving ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  TAB 3: Сбор данных                                          */}
      {/* ============================================================ */}
      {activeTab === 'discovery' && (
        <div className="space-y-6">
          {discoveryLoading ? (
            <div className="crm-panel p-8 rounded-2xl text-center text-slate-500 text-sm">Загрузка…</div>
          ) : (
            <>
              <div className="crm-panel p-6 rounded-2xl space-y-5">
                <h3 className={sectionTitleCls}>Города</h3>
                <p className={helpCls}>Города для сканирования 2GIS. Введите название и нажмите Enter.</p>
                <TagInput tags={cities} onChange={setCities} placeholder="Добавить город…" />
              </div>

              <div className="crm-panel p-6 rounded-2xl space-y-5">
                <h3 className={sectionTitleCls}>Категории</h3>
                <p className={helpCls}>Категории бизнесов для поиска.</p>
                <TagInput tags={categories} onChange={setCategories} placeholder="Добавить категорию…" />
              </div>

              <div className="flex justify-end">
                <button type="button" disabled={discoverySaving} onClick={() => void saveDiscovery()} className={saveBtnCls}>
                  {discoverySaving ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  TAB 4: Компания                                             */}
      {/* ============================================================ */}
      {activeTab === 'company' && (
        <div className="space-y-6">
          {companyLoading ? (
            <div className="crm-panel p-8 rounded-2xl text-center text-slate-500 text-sm">Загрузка…</div>
          ) : (
            <>
              <div className="crm-panel p-6 rounded-2xl space-y-5">
                <h3 className={sectionTitleCls}>Информация о компании</h3>
                <div className="space-y-4">
                  <FieldRow label="Название (EN)">
                    <input type="text" value={company.name} onChange={(e) => setComp('name', e.target.value)} className={inputCls} />
                  </FieldRow>
                  <FieldRow label="Название (RU)">
                    <input type="text" value={company.name_ru} onChange={(e) => setComp('name_ru', e.target.value)} className={inputCls} />
                  </FieldRow>
                  <FieldRow label="Слоган (EN)">
                    <input type="text" value={company.tagline} onChange={(e) => setComp('tagline', e.target.value)} className={inputCls} />
                  </FieldRow>
                  <FieldRow label="Слоган (RU)">
                    <input type="text" value={company.tagline_ru} onChange={(e) => setComp('tagline_ru', e.target.value)} className={inputCls} />
                  </FieldRow>
                  <FieldRow label="Сайт">
                    <input type="url" value={company.website} onChange={(e) => setComp('website', e.target.value)} placeholder="https://…" className={inputCls} />
                  </FieldRow>
                  <FieldRow label="Ссылка на календарь">
                    <input type="url" value={company.calendar_url} onChange={(e) => setComp('calendar_url', e.target.value)} placeholder="https://cal.com/…" className={inputCls} />
                  </FieldRow>
                  <FieldRow label="WhatsApp номер">
                    <input type="text" value={company.whatsapp} onChange={(e) => setComp('whatsapp', e.target.value)} placeholder="+77…" className={inputCls} />
                  </FieldRow>
                </div>
              </div>

              <div className="flex justify-end">
                <button type="button" disabled={companySaving} onClick={() => void saveCompany()} className={saveBtnCls}>
                  {companySaving ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  TAB 5: Данные                                               */}
      {/* ============================================================ */}
      {activeTab === 'data' && (
        <div className="space-y-6">
          {/* Actions */}
          <div className="crm-panel p-6 rounded-2xl space-y-4">
            <h3 className={sectionTitleCls}>Действия</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const url = apiUrl('/api/companies/export')
                    const res = await authFetch(url)
                    if (!res.ok) { toast('Ошибка экспорта', 'error'); return }
                    const blob = await res.blob()
                    const blobUrl = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = blobUrl
                    a.download = 'leads.csv'
                    a.click()
                    URL.revokeObjectURL(blobUrl)
                  } catch {
                    toast('Не удалось выполнить экспорт', 'error')
                  }
                }}
                className="p-4 bg-slate-950/40 border border-white/5 rounded-xl text-[13px] font-semibold text-slate-300 hover:bg-sky-500/10 hover:border-sky-500/25 hover:text-sky-200 transition-all text-left"
              >
                Экспорт лидов (CSV)
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const res = await authFetch(apiUrl('/api/scrapers/re-enrich'), { method: 'POST' })
                    const data = (await res.json()) as { count?: number }
                    if (data.count && data.count > 0) {
                      toast(`В очередь: ${data.count} лидов на повторное обогащение`, 'success')
                    } else {
                      toast('Нет «устаревших» лидов (30+ дней)', 'info')
                    }
                  } catch {
                    toast('Запрос не выполнен', 'error')
                  }
                }}
                className="p-4 bg-slate-950/40 border border-white/5 rounded-xl text-[13px] font-semibold text-slate-300 hover:bg-sky-500/10 hover:border-sky-500/25 hover:text-sky-200 transition-all text-left"
              >
                Повторно обогатить устаревшие (30+ дней)
              </button>
            </div>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="crm-panel p-5 rounded-2xl space-y-1">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Всего лидов</span>
              <div className="text-3xl font-bold text-sky-400 tabular-nums">{stats?.totalLeads?.toLocaleString() ?? '—'}</div>
            </div>
            <div className="crm-panel p-5 rounded-2xl space-y-1">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Обогащено</span>
              <div className="text-3xl font-bold text-emerald-400 tabular-nums">{stats?.enrichedLeads?.toLocaleString() ?? '—'}</div>
            </div>
            <div className="crm-panel p-5 rounded-2xl space-y-1">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Скраперы в работе</span>
              <div className="text-3xl font-bold text-amber-400 tabular-nums">{stats?.runningJobs ?? '—'}</div>
            </div>
          </div>

          {/* Runs table */}
          <div className="crm-panel p-6 rounded-2xl">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h3 className={sectionTitleCls}>Последние запуски 2GIS</h3>
              <button
                type="button"
                onClick={() => {
                  void loadStats()
                  void loadRuns({ bustCache: true })
                  toast('Обновлено', 'success')
                }}
                className="px-3 py-1.5 rounded-lg border border-white/10 text-xs font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Обновить
              </button>
            </div>
            {runsError && <p className="text-[13px] text-rose-400 mb-3">{runsError}</p>}
            <div className="overflow-x-auto rounded-xl border border-white/5">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-white/10 text-slate-500">
                    <th className="p-3 font-semibold">Старт</th>
                    <th className="p-3 font-semibold">Статус</th>
                    <th className="p-3 font-semibold">Записей</th>
                    <th className="p-3 font-semibold">Ошибка</th>
                    <th className="p-3 font-semibold">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 && !runsError ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-slate-500 text-center text-sm">
                        Запусков пока нет.
                      </td>
                    </tr>
                  ) : (
                    runs.map((r) => (
                      <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="p-3 text-slate-300 whitespace-nowrap">{formatWhen(r.startedAt)}</td>
                        <td className="p-3">
                          <span className={`inline-block px-2 py-0.5 rounded-md border text-xs font-bold uppercase ${statusStyles(r.status)}`}>
                            {runStatusLabel(r.status)}
                          </span>
                        </td>
                        <td className="p-3 text-slate-300 font-mono tabular-nums">{r.resultsCount ?? '—'}</td>
                        <td className="p-3 text-rose-300/90 max-w-xs truncate" title={r.error ?? undefined}>
                          {r.error ?? '—'}
                        </td>
                        <td className="p-3 text-slate-500 font-mono text-xs">{r.id.slice(0, 8)}…</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import React, { useCallback, useEffect, useState } from 'react'
import { extractContextFrom2gisUrl } from '../../lib/2gis-context'
import { dashboardUrlFromApi } from '../../lib/dashboard-url'
import { DEFAULT_LOCAL_API_ORIGIN } from '../../lib/local-api-default'
import { normalizeSpreadsheetId } from '../../lib/sink-settings'
import './popup.css'

const CITIES = [
  'Алматы', 'Астана', 'Шымкент', 'Караганда', 'Актобе', 'Тараз', 'Павлодар',
  'Усть-Каменогорск', 'Семей', 'Атырау', 'Костанай', 'Кызылорда', 'Уральск',
  'Петропавловск', 'Актау', 'Темиртау', 'Туркестан', 'Кокшетау', 'Талдыкорган',
  'Экибастуз', 'Рудный', 'Жанаозен',
]

const CITY_SLUGS: Record<string, string> = {
  'Алматы': 'almaty', 'Астана': 'astana', 'Шымкент': 'shymkent',
  'Караганда': 'karaganda', 'Актобе': 'aktobe', 'Тараз': 'taraz',
  'Павлодар': 'pavlodar', 'Усть-Каменогорск': 'ust_kamenogorsk',
  'Семей': 'semey', 'Атырау': 'atyrau', 'Костанай': 'kostanay',
  'Кызылорда': 'kyzylorda', 'Уральск': 'uralsk', 'Петропавловск': 'petropavlovsk',
  'Актау': 'aktau', 'Темиртау': 'temirtau', 'Туркестан': 'turkestan',
  'Кокшетау': 'kokshetau', 'Талдыкорган': 'taldykorgan',
  'Экибастуз': 'ekibastuz', 'Рудный': 'rudnyy', 'Жанаозен': 'zhanaozen',
}

type PageType = { isFirm: boolean; isSearch: boolean; url: string }
type EventItem = { at: string; level: 'info' | 'warn' | 'error'; message: string }
type SinkHealthItem = {
  status: 'idle' | 'ok' | 'error'
  lastMessage: string
  lastAt: string | null
  retryPending: number
  lastSent?: number
  lastInserted?: number
  lastDuplicate?: number
  lastRejected?: number
}
type Status = {
  sessionCount: number
  lastSyncTime: string | null
  queueSize: number
  deadLetterCount?: number
  flushFailures?: number
  lastError?: string | null
  recentEvents?: EventItem[]
  bulkRunning?: boolean
  bulkDone?: number
  bulkTotal?: number
  autoCaptures?: number
  lastAutoCaptureAt?: string | null
  lastEnrichmentAt?: string | null
  lastEnrichmentStatus?: 'idle' | 'success' | 'warn'
  cityMismatchCount?: number
  lastCityMismatchAt?: string | null
  sinkHealth?: {
    api: SinkHealthItem
    webhook: SinkHealthItem
    sheets: SinkHealthItem
  }
}

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <label className="ly-switch">
      <input type="checkbox" checked={checked} onChange={() => onChange()} />
      <span className="ly-switch-slider" />
    </label>
  )
}

export default function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_LOCAL_API_ORIGIN)
  const [city, setCity] = useState('Алматы')
  const [category, setCategory] = useState('кафе')
  const [autoMode, setAutoMode] = useState(false)
  const [websiteFollow, setWebsiteFollow] = useState(true)
  const [dockEnabled, setDockEnabled] = useState(true)
  const [sinkApiEnabled, setSinkApiEnabled] = useState(true)
  const [apiServiceKey, setApiServiceKey] = useState('')
  const [sinkWebhookEnabled, setSinkWebhookEnabled] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [sinkSheetsEnabled, setSinkSheetsEnabled] = useState(false)
  const [spreadsheetId, setSpreadsheetId] = useState('')
  const [sheetsRange, setSheetsRange] = useState('Sheet1!A1')
  const [bulkMaxPages, setBulkMaxPages] = useState(3)
  const [status, setStatus] = useState<Status>({ sessionCount: 0, lastSyncTime: null, queueSize: 0 })
  const [pageType, setPageType] = useState<PageType | null>(null)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)
  const [websiteBusy, setWebsiteBusy] = useState(false)
  const [tab, setTab] = useState<'home' | 'settings'>('home')
  const [apiHealth, setApiHealth] = useState<'ok' | 'error' | 'checking' | null>(null)
  const [version, setVersion] = useState('')

  const flash = useCallback((text: string, ok: boolean) => {
    setMessage({ text, ok })
    setTimeout(() => setMessage(null), 2800)
  }, [])

  const refreshStatus = useCallback(() => {
    chrome.runtime.sendMessage({ action: 'getStatus' }, (resp) => {
      if (resp) setStatus(resp)
    })
  }, [])

  const detectPage = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getPageType' }, (resp) => {
        if (chrome.runtime.lastError) {
          setPageType(null)
          return
        }
        if (resp) {
          setPageType(resp)
          if (resp.isSearch && typeof resp.url === 'string') {
            try {
              const u = new URL(resp.url)
              const m = u.pathname.match(/\/search\/([^/]+)/)
              if (m?.[1]) {
                const q = decodeURIComponent(m[1]).trim()
                if (q && (!category || category.trim().length === 0)) setCategory(q)
              }
            } catch {
              // ignore
            }
          }
        }
      })
    })
  }, [category])

  const checkApiHealth = useCallback(() => {
    setApiHealth('checking')
    const url = `${apiUrl.replace(/\/$/, '')}/health`
    fetch(url, { method: 'GET' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        setApiHealth(j?.status === 'ok' ? 'ok' : 'error')
      })
      .catch(() => setApiHealth('error'))
  }, [apiUrl])

  useEffect(() => {
    try {
      setVersion(chrome.runtime.getManifest?.()?.version ?? '')
    } catch {
      setVersion('')
    }
  }, [])

  useEffect(() => {
    if (sinkApiEnabled) checkApiHealth()
  }, [checkApiHealth, sinkApiEnabled])

  useEffect(() => {
    chrome.storage.local.get(
      [
        'apiUrl',
        'autoMode',
        'websiteFollow',
        'bulkMaxPages',
        'dockEnabled',
        'sinkApiEnabled',
        'apiServiceKey',
        'sinkWebhookEnabled',
        'webhookUrl',
        'webhookSecret',
        'sinkSheetsEnabled',
        'spreadsheetId',
        'sheetsRange',
      ],
      (result) => {
        if (result.apiUrl) setApiUrl(result.apiUrl)
        if (result.autoMode !== undefined) setAutoMode(result.autoMode)
        if (result.websiteFollow !== undefined) setWebsiteFollow(Boolean(result.websiteFollow))
        if (result.dockEnabled !== undefined) setDockEnabled(Boolean(result.dockEnabled))
        if (result.sinkApiEnabled !== undefined) setSinkApiEnabled(Boolean(result.sinkApiEnabled))
        if (typeof result.apiServiceKey === 'string') setApiServiceKey(result.apiServiceKey)
        if (result.sinkWebhookEnabled !== undefined) setSinkWebhookEnabled(Boolean(result.sinkWebhookEnabled))
        if (typeof result.webhookUrl === 'string') setWebhookUrl(result.webhookUrl)
        if (typeof result.webhookSecret === 'string') setWebhookSecret(result.webhookSecret)
        if (result.sinkSheetsEnabled !== undefined) setSinkSheetsEnabled(Boolean(result.sinkSheetsEnabled))
        if (typeof result.spreadsheetId === 'string') setSpreadsheetId(result.spreadsheetId)
        if (typeof result.sheetsRange === 'string' && result.sheetsRange.trim()) setSheetsRange(result.sheetsRange.trim())
        if (typeof result.bulkMaxPages === 'number' && Number.isFinite(result.bulkMaxPages)) {
          setBulkMaxPages(Math.max(1, Math.min(20, Math.floor(result.bulkMaxPages))))
        }
        const savedCity = (result as { selectedCity?: string }).selectedCity
        const savedCategory = (result as { selectedCategory?: string }).selectedCategory
        if (savedCity) setCity(savedCity)
        if (savedCategory) setCategory(savedCategory)
      }
    )
    refreshStatus()
    detectPage()

    const id = setInterval(() => {
      refreshStatus()
      detectPage()
    }, 2500)

    const progressListener = (msg: { action?: string; done?: number; total?: number }) => {
      if (msg.action === 'bulkProgress' && msg.done !== undefined && msg.total !== undefined) {
        setBulkProgress({ done: msg.done, total: msg.total })
      }
    }
    chrome.runtime.onMessage.addListener(progressListener)

    return () => {
      clearInterval(id)
      chrome.runtime.onMessage.removeListener(progressListener)
    }
  }, [refreshStatus, detectPage])

  useEffect(() => {
    chrome.storage.local.set({ selectedCity: city })
  }, [city])

  useEffect(() => {
    chrome.storage.local.set({ selectedCategory: category })
  }, [category])

  useEffect(() => {
    chrome.storage.local.set({ bulkMaxPages })
  }, [bulkMaxPages])

  useEffect(() => {
    chrome.storage.local.set({ dockEnabled })
  }, [dockEnabled])

  useEffect(() => {
    chrome.storage.local.set({ sinkApiEnabled })
  }, [sinkApiEnabled])

  useEffect(() => {
    chrome.storage.local.set({ apiServiceKey })
  }, [apiServiceKey])

  useEffect(() => {
    chrome.storage.local.set({ sinkWebhookEnabled })
  }, [sinkWebhookEnabled])

  useEffect(() => {
    chrome.storage.local.set({ webhookUrl })
  }, [webhookUrl])

  useEffect(() => {
    chrome.storage.local.set({ webhookSecret })
  }, [webhookSecret])

  useEffect(() => {
    chrome.storage.local.set({ sinkSheetsEnabled })
  }, [sinkSheetsEnabled])

  useEffect(() => {
    chrome.storage.local.set({ spreadsheetId })
  }, [spreadsheetId])

  useEffect(() => {
    chrome.storage.local.set({ sheetsRange })
  }, [sheetsRange])

  const saveApiUrl = () => {
    chrome.storage.local.set({ apiUrl })
    flash('Адрес API сохранен', true)
  }

  const toggleAutoMode = () => {
    const next = !autoMode
    setAutoMode(next)
    chrome.storage.local.set({ autoMode: next })
    flash(next ? 'Автопилот включен' : 'Автопилот выключен', true)
  }

  const toggleWebsiteFollow = () => {
    const next = !websiteFollow
    setWebsiteFollow(next)
    chrome.storage.local.set({ websiteFollow: next })
    flash(next ? 'Сбор с сайта включен' : 'Сбор с сайта выключен', true)
  }

  const toggleDock = () => {
    const next = !dockEnabled
    setDockEnabled(next)
    chrome.storage.local.set({ dockEnabled: next })
    flash(next ? 'Панель на 2GIS включена' : 'Панель на 2GIS скрыта', true)
  }

  const withActiveTab = (cb: (tabId: number) => void) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        flash('Не удалось получить активную вкладку', false)
        return
      }
      cb(tabs[0].id)
    })
  }

  const handleScrapeCurrentPage = () => {
    const fromPage = extractContextFrom2gisUrl(pageType?.url || '')
    withActiveTab((tabId) => {
      setBusy(true)
      chrome.runtime.sendMessage(
        {
          action: 'manualExtract',
          tabId,
          city: fromPage.city || city,
          category: fromPage.category || undefined,
        },
        (resp) => {
          setBusy(false)
          if (resp?.ok) {
            flash(`Сохранено: ${resp.lead?.name || 'компания'}`, true)
            refreshStatus()
          } else {
            flash(resp?.error || 'Не удалось извлечь данные', false)
          }
        }
      )
    })
  }

  const handleBulkScrape = () => {
    if (!window.confirm('Начать массовый сбор компаний с этой страницы?')) return
    const fromPage = extractContextFrom2gisUrl(pageType?.url || '')
    withActiveTab((tabId) => {
      setBusy(true)
      setBulkProgress({ done: 0, total: 0 })
      chrome.runtime.sendMessage(
        {
          action: 'bulkScrape',
          tabId,
          city: fromPage.city || city,
          category: fromPage.category || category,
          maxPages: bulkMaxPages,
        },
        (resp) => {
          setBusy(false)
          setBulkProgress(null)
          if (resp?.ok) {
            flash(`Массовый сбор завершен: ${resp.extracted} лидов`, true)
            refreshStatus()
          } else {
            flash(resp?.error || 'Ошибка массового сбора', false)
          }
        }
      )
    })
  }

  const handleStopBulk = () => {
    if (!window.confirm('Остановить массовый сбор?')) return
    chrome.runtime.sendMessage({ action: 'stopBulk' }, () => {
      flash('Останавливаю сбор… дождитесь завершения текущей карточки', true)
      refreshStatus()
    })
  }

  const handleWebsiteFollow = () => {
    const fromPage = extractContextFrom2gisUrl(pageType?.url || '')
    withActiveTab((tabId) => {
      setWebsiteBusy(true)
      chrome.runtime.sendMessage(
        {
          action: 'websiteFollowOnly',
          tabId,
          city: fromPage.city || city,
          category: fromPage.category || undefined,
        },
        (resp) => {
          setWebsiteBusy(false)
          if (resp?.ok) {
            flash('Дособор сайта выполнен', true)
            refreshStatus()
          } else {
            flash(resp?.error || 'Ошибка дособора сайта', false)
          }
        }
      )
    })
  }

  const handleOpenSearch = () => {
    if (!category.trim()) {
      flash('Введите категорию для поиска', false)
      return
    }
    const slug = CITY_SLUGS[city] || 'almaty'
    const url = `https://2gis.kz/${slug}/search/${encodeURIComponent(category.trim())}`
    withActiveTab((tabId) => {
      chrome.tabs.update(tabId, { url })
      flash('Открываю поиск 2GIS…', true)
    })
  }

  const formatTime = (iso: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }

  const pageLabel =
    pageType?.isFirm ? 'Карточка' : pageType?.isSearch ? 'Поиск' : 'Не 2GIS'
  const pageOk = Boolean(pageType?.isFirm || pageType?.isSearch)

  const bulkDone = status.bulkDone ?? bulkProgress?.done ?? 0
  const bulkTotal = status.bulkTotal ?? bulkProgress?.total ?? 0
  const bulkPercent = bulkTotal > 0 ? (bulkDone / bulkTotal) * 100 : 0
  const sinkHealth = status.sinkHealth

  const handleCopyDiagnostics = () => {
    const payload = {
      pageType,
      status,
      settings: {
        autoMode,
        websiteFollow,
        bulkMaxPages,
        apiUrl,
        city,
        category,
        dockEnabled,
        sinkApiEnabled,
        sinkWebhookEnabled,
        sinkSheetsEnabled,
      },
      at: new Date().toISOString(),
    }
    navigator.clipboard
      .writeText(JSON.stringify(payload, null, 2))
      .then(() => flash('Диагностика скопирована', true))
      .catch(() => flash('Не удалось скопировать диагностику', false))
  }

  const openDashboard = () => {
    const dash = dashboardUrlFromApi(apiUrl)
    chrome.tabs.create({ url: dash })
  }

  const exportLocal = (format: 'csv' | 'json') => {
    chrome.runtime.sendMessage({ action: 'exportLeads', format }, (r) => {
      if (chrome.runtime.lastError) {
        flash(chrome.runtime.lastError.message || 'Ошибка', false)
        return
      }
      if (r?.ok) flash(format === 'csv' ? 'CSV: сохранение файла…' : 'JSON: сохранение файла…', true)
      else flash(r?.error || 'Ошибка экспорта', false)
    })
  }

  const handleRetryDeadLetters = () => {
    chrome.runtime.sendMessage({ action: 'retryDeadLetters' }, (r) => {
      if (r?.ok) {
        flash(`Повтор queued: ${r.count || 0}`, true)
        refreshStatus()
      } else {
        flash(r?.error || 'Не удалось отправить dead-letter в очередь', false)
      }
    })
  }

  const handleClearDeadLetters = () => {
    if (!window.confirm('Очистить dead-letter записи без повторной отправки?')) return
    chrome.runtime.sendMessage({ action: 'clearDeadLetters' }, (r) => {
      if (r?.ok) {
        flash('Dead-letter очищен', true)
        refreshStatus()
      } else {
        flash(r?.error || 'Не удалось очистить dead-letter', false)
      }
    })
  }

  return (
    <div className="ly-app">
      <header className="ly-header">
        <div className="ly-brand-row">
          <div>
            <h1 className="ly-wordmark">Leadiya</h1>
            <p className="ly-tagline">Лиды из 2GIS в вашу CRM</p>
          </div>
          <div className={`ly-page-badge ${pageOk ? 'ly-page-badge--on' : 'ly-page-badge--off'}`}>
            {pageLabel}
          </div>
        </div>
        <nav className="ly-tabs" aria-label="Разделы">
          <button
            type="button"
            className={`ly-tab ${tab === 'home' ? 'ly-tab--active' : ''}`}
            onClick={() => setTab('home')}
          >
            Главная
          </button>
          <button
            type="button"
            className={`ly-tab ${tab === 'settings' ? 'ly-tab--active' : ''}`}
            onClick={() => setTab('settings')}
          >
            Настройки
          </button>
        </nav>
      </header>

      <div className="ly-scroll">
        {tab === 'home' ? (
          <>
            {status.bulkRunning ? (
              <div className="ly-banner ly-banner--warn">
                Сбор идет: {bulkDone}/{bulkTotal}. Остановить можно красной кнопкой ниже.
              </div>
            ) : status.lastError ? (
              <div className="ly-banner ly-banner--err">Ошибка: {status.lastError}</div>
            ) : (
              <div className="ly-banner ly-banner--ok">Связь с расширением активна. Выберите действие ниже.</div>
            )}

            <section className="ly-section">
              <h2 className="ly-section-title">Панель и API</h2>
              <div className="ly-panel">
                <div className="ly-connect-row">
                  <div className="ly-connect-meta">
                    <div style={{ fontSize: 12, fontWeight: 700 }}>Подключение</div>
                    <div className="ly-api-line">{apiUrl.replace(/^https?:\/\//, '')}</div>
                    {sinkApiEnabled ? (
                      <div className="ly-health">
                        <span
                          className={`ly-health-dot ${
                            apiHealth === 'ok' ? 'ly-health-dot--ok' : apiHealth === 'error' ? 'ly-health-dot--err' : ''
                          }`}
                        />
                        {apiHealth === 'checking'
                          ? 'Проверка…'
                          : apiHealth === 'ok'
                            ? 'API в сети'
                            : apiHealth === 'error'
                              ? 'API недоступен'
                              : '—'}
                      </div>
                    ) : (
                      <div className="ly-health" style={{ color: 'var(--ly-muted)' }}>
                        Канал Leadiya API выключен в настройках
                      </div>
                    )}
                  </div>
                  <div className="ly-actions-col">
                    <button type="button" className="ly-btn ly-btn--ghost" onClick={openDashboard}>
                      Открыть CRM
                    </button>
                    {sinkApiEnabled ? (
                      <button type="button" className="ly-btn ly-btn--ghost" onClick={checkApiHealth}>
                        Проверить API
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="ly-section">
              <h2 className="ly-section-title">Сессия</h2>
              <div className="ly-stat-grid">
                <div className="ly-stat">
                  <span className="ly-stat-val">{status.sessionCount}</span>
                  <span className="ly-stat-label">За сессию</span>
                </div>
                <div className="ly-stat">
                  <span className="ly-stat-val" style={{ color: status.bulkRunning ? 'var(--ly-warn)' : 'var(--ly-success)' }}>
                    {status.bulkRunning ? '●' : '○'}
                  </span>
                  <span className="ly-stat-label">Массовый</span>
                </div>
                <div className="ly-stat">
                  <span className="ly-stat-val">{status.queueSize}</span>
                  <span className="ly-stat-label">В очереди</span>
                </div>
              </div>
              {(status.deadLetterCount ?? 0) > 0 ? (
                <div className="ly-dead-letter-strip">
                  <span>
                    Dead-letter: <strong>{status.deadLetterCount}</strong>
                  </span>
                  <div className="ly-inline-row">
                    <button type="button" className="ly-btn ly-btn--ghost" onClick={handleRetryDeadLetters}>
                      Повторить
                    </button>
                    <button type="button" className="ly-btn ly-btn--ghost" onClick={handleClearDeadLetters}>
                      Очистить
                    </button>
                  </div>
                </div>
              ) : null}
              {status.bulkRunning ? (
                <div className="ly-bulk-msg">
                  Фоновый режим: можно закрыть это окно — сбор продолжится.
                </div>
              ) : null}
              {status.lastError ? (
                <div className="ly-toast ly-toast--err" style={{ marginTop: 10 }}>
                  {status.lastError}
                </div>
              ) : null}
              {status.queueSize > 0 ? (
                <div className="ly-inline-row" style={{ marginTop: 12 }}>
                  <button type="button" className="ly-btn ly-btn--ghost" onClick={() => exportLocal('csv')}>
                    Скачать CSV
                  </button>
                  <button type="button" className="ly-btn ly-btn--ghost" onClick={() => exportLocal('json')}>
                    Скачать JSON
                  </button>
                </div>
              ) : null}
            </section>

            <section className="ly-section">
              <h2 className="ly-section-title">Каналы доставки</h2>
              <div className="ly-sink-grid">
                {[
                  ['api', 'CRM API'],
                  ['webhook', 'Webhook'],
                  ['sheets', 'Google Sheets'],
                ].map(([key, title]) => {
                  const item = sinkHealth?.[key as keyof typeof sinkHealth]
                  const statusClass =
                    item?.status === 'ok' ? 'ly-sink-card--ok' : item?.status === 'error' ? 'ly-sink-card--err' : ''
                  const statusLabel =
                    item?.status === 'ok' ? 'OK' : item?.status === 'error' ? 'Ошибка' : 'Ожидание'
                  return (
                    <div key={key} className={`ly-sink-card ${statusClass}`}>
                      <div className="ly-sink-head">
                        <strong>{title}</strong>
                        <span>{statusLabel}</span>
                      </div>
                      <div className="ly-sink-meta">
                        <span>В retry: {item?.retryPending ?? 0}</span>
                        <span>{item?.lastAt ? formatTime(item.lastAt) : '—'}</span>
                      </div>
                      <div className="ly-sink-msg">{item?.lastMessage || 'Пока нет событий по каналу'}</div>
                      {key === 'api' && item ? (
                        <div className="ly-sink-chips">
                          <span className="ly-chip ly-chip--ok">ins {item.lastInserted ?? 0}</span>
                          <span className="ly-chip">dup {item.lastDuplicate ?? 0}</span>
                          <span className="ly-chip ly-chip--err">rej {item.lastRejected ?? 0}</span>
                        </div>
                      ) : item?.lastSent !== undefined ? (
                        <div className="ly-sink-chips">
                          <span className="ly-chip ly-chip--ok">sent {item.lastSent}</span>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="ly-section">
              <h2 className="ly-section-title">Действие</h2>
              <div className="ly-cta-wrap">
                <div className="ly-cta-inner">
                  {status.bulkRunning ? (
                    <button type="button" className="ly-btn ly-btn--danger" onClick={handleStopBulk}>
                      Остановить сбор
                    </button>
                  ) : pageType?.isFirm ? (
                    <button type="button" className="ly-btn ly-btn--primary" disabled={busy} onClick={handleScrapeCurrentPage}>
                      {busy ? 'Собираю…' : 'Собрать эту компанию'}
                    </button>
                  ) : pageType?.isSearch ? (
                    <button type="button" className="ly-btn ly-btn--primary" disabled={busy} onClick={handleBulkScrape}>
                      {busy ? 'Запуск…' : 'Собрать список на странице'}
                    </button>
                  ) : (
                    <button type="button" className="ly-btn ly-btn--primary" onClick={handleOpenSearch}>
                      Открыть 2GIS и начать
                    </button>
                  )}
                  <p className="ly-cta-hint">
                    {status.bulkRunning
                      ? `Прогресс: ${bulkDone} / ${bulkTotal}`
                      : pageType?.isFirm
                        ? 'Сохранит карточку в Leadiya (с дособором сайта, если включен).'
                        : pageType?.isSearch
                          ? 'Обойдет карточки в выдаче и поставит лиды в очередь.'
                          : 'Откроет поиск по городу и категории из настроек.'}
                  </p>
                  {status.bulkRunning ? (
                    <div className="ly-progress">
                      <i style={{ width: `${bulkPercent}%` }} />
                    </div>
                  ) : null}
                </div>
              </div>
              {message ? (
                <div className={`ly-toast ${message.ok ? 'ly-toast--ok' : 'ly-toast--err'}`}>{message.text}</div>
              ) : null}
            </section>

            <section className="ly-section">
              <h2 className="ly-section-title">Как это работает</h2>
              <ul className="ly-steps">
                <li>Откройте 2GIS: карточку компании или поиск.</li>
                <li>Нажмите главную кнопку выше — данные уйдут в CRM.</li>
                <li>На странице 2GIS можно пользоваться быстрой панелью Leadiya (включите в настройках).</li>
              </ul>
            </section>
          </>
        ) : (
          <>
            <section className="ly-section">
              <h2 className="ly-section-title">Куда отправлять лиды</h2>
              <p className="ly-field-hint">
                Включите один или несколько каналов. Без каналов лиды остаются в очереди — используйте экспорт в файл.
              </p>
              <div className="ly-panel">
                <div className="ly-toggle">
                  <div>
                    <div className="ly-toggle-title">Leadiya API</div>
                    <div className="ly-toggle-desc">Сервер CRM (POST /api/leads/bulk)</div>
                  </div>
                  <Switch
                    checked={sinkApiEnabled}
                    onChange={() => {
                      const n = !sinkApiEnabled
                      setSinkApiEnabled(n)
                      chrome.storage.local.set({ sinkApiEnabled: n })
                    }}
                  />
                </div>
                <div className="ly-toggle">
                  <div>
                    <div className="ly-toggle-title">Webhook</div>
                    <div className="ly-toggle-desc">Zapier, Make, свой backend (JSON)</div>
                  </div>
                  <Switch
                    checked={sinkWebhookEnabled}
                    onChange={() => {
                      const n = !sinkWebhookEnabled
                      setSinkWebhookEnabled(n)
                      chrome.storage.local.set({ sinkWebhookEnabled: n })
                    }}
                  />
                </div>
                <div className="ly-toggle">
                  <div>
                    <div className="ly-toggle-title">Google Таблицы</div>
                    <div className="ly-toggle-desc">Добавление строк через Google API (нужен OAuth в сборке)</div>
                  </div>
                  <Switch
                    checked={sinkSheetsEnabled}
                    onChange={() => {
                      const n = !sinkSheetsEnabled
                      setSinkSheetsEnabled(n)
                      chrome.storage.local.set({ sinkSheetsEnabled: n })
                    }}
                  />
                </div>
              </div>
            </section>

            <section className="ly-section">
              <h2 className="ly-section-title">Leadiya API</h2>
              <p className="ly-field-hint">Базовый URL и опционально ключ X-Leadiya-Service-Key (как LEADIYA_AGENT_SERVICE_KEY на сервере)</p>
              <div className="ly-inline-row">
                <input
                  className="ly-input"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="http://localhost:3041"
                />
                <button type="button" className="ly-btn ly-btn--ghost" style={{ width: 'auto' }} onClick={saveApiUrl}>
                  Сохранить
                </button>
              </div>
              <input
                className="ly-input"
                style={{ marginTop: 8 }}
                value={apiServiceKey}
                onChange={(e) => setApiServiceKey(e.target.value)}
                placeholder="Сервисный ключ (если требуется)"
                type="password"
                autoComplete="off"
              />
            </section>

            <section className="ly-section">
              <h2 className="ly-section-title">Webhook</h2>
              <p className="ly-field-hint">POST JSON: source, sentAt, leads[]. Опционально HMAC SHA-256 в X-Leadiya-Signature</p>
              <input
                className="ly-input"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://hooks.zapier.com/..."
              />
              <input
                className="ly-input"
                style={{ marginTop: 8 }}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="Секрет для подписи (необязательно)"
                type="password"
                autoComplete="off"
              />
            </section>

            <section className="ly-section">
              <h2 className="ly-section-title">Google Sheets</h2>
              <p className="ly-field-hint">
                ID таблицы или полная ссылка. Сборка с WXT_GOOGLE_CLIENT_ID добавляет OAuth2 в манифест.
              </p>
              <input
                className="ly-input"
                value={spreadsheetId}
                onChange={(e) => setSpreadsheetId(normalizeSpreadsheetId(e.target.value))}
                placeholder="1abc... или URL таблицы"
              />
              <input
                className="ly-input"
                style={{ marginTop: 8 }}
                value={sheetsRange}
                onChange={(e) => setSheetsRange(e.target.value)}
                placeholder="Sheet1!A1"
              />
            </section>

            <section className="ly-section">
              <h2 className="ly-section-title">Локальный файл</h2>
              <p className="ly-field-hint">Скачать текущую очередь лидов (очередь не очищается)</p>
              <div className="ly-inline-row">
                <button type="button" className="ly-btn ly-btn--ghost" onClick={() => exportLocal('csv')}>
                  Экспорт CSV
                </button>
                <button type="button" className="ly-btn ly-btn--ghost" onClick={() => exportLocal('json')}>
                  Экспорт JSON
                </button>
              </div>
            </section>

            <section className="ly-section">
              <h2 className="ly-section-title">Поиск по умолчанию</h2>
              <p className="ly-field-hint">Если вы не на 2GIS — для кнопки «Открыть 2GIS» на главной</p>
              <select className="ly-select" value={city} onChange={(e) => setCity(e.target.value)}>
                {CITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                className="ly-input"
                style={{ marginTop: 8 }}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Категория (например кафе)"
              />
            </section>

            <section className="ly-section">
              <h2 className="ly-section-title">Массовый сбор</h2>
              <p className="ly-field-hint">Сколько страниц списка обходить при сборе</p>
              <input
                className="ly-input"
                type="number"
                min={1}
                max={20}
                value={bulkMaxPages}
                onChange={(e) => {
                  const n = Number(e.target.value || 1)
                  setBulkMaxPages(Math.max(1, Math.min(20, Number.isFinite(n) ? Math.floor(n) : 1)))
                }}
              />
            </section>

            <section className="ly-section">
              <h2 className="ly-section-title">Поведение</h2>
              <div className="ly-panel">
                <div className="ly-toggle">
                  <div>
                    <div className="ly-toggle-title">Автопилот</div>
                    <div className="ly-toggle-desc">Автосбор при открытии карточек компании</div>
                  </div>
                  <Switch checked={autoMode} onChange={toggleAutoMode} />
                </div>
                <div className="ly-toggle">
                  <div>
                    <div className="ly-toggle-title">Дособор с сайта</div>
                    <div className="ly-toggle-desc">Email и телефоны с сайта после 2GIS</div>
                  </div>
                  <Switch checked={websiteFollow} onChange={toggleWebsiteFollow} />
                </div>
                <div className="ly-toggle">
                  <div>
                    <div className="ly-toggle-title">Панель на 2GIS</div>
                    <div className="ly-toggle-desc">Компактная панель на странице карт — быстрый сбор без popup</div>
                  </div>
                  <Switch checked={dockEnabled} onChange={toggleDock} />
                </div>
              </div>
              {pageType?.isFirm && !status.bulkRunning ? (
                <button
                  type="button"
                  className="ly-btn ly-btn--ghost"
                  style={{ marginTop: 12 }}
                  disabled={websiteBusy}
                  onClick={handleWebsiteFollow}
                >
                  {websiteBusy ? 'Дособор сайта…' : 'Только дособор сайта (текущая карточка)'}
                </button>
              ) : null}
            </section>

            <section className="ly-section">
              <h2 className="ly-section-title">Подробный статус</h2>
              <div className="ly-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: 'var(--ly-muted)' }}>Автопилот, захватов</span>
                  <strong>{status.autoCaptures ?? 0}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: 'var(--ly-muted)' }}>Дособор сайта</span>
                  <strong
                    style={{
                      color:
                        status.lastEnrichmentStatus === 'success'
                          ? 'var(--ly-success)'
                          : status.lastEnrichmentStatus === 'warn'
                            ? 'var(--ly-warn)'
                            : 'var(--ly-muted)',
                    }}
                  >
                    {status.lastEnrichmentStatus === 'success'
                      ? 'Ок'
                      : status.lastEnrichmentStatus === 'warn'
                        ? 'Предупреждение'
                        : '—'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: 'var(--ly-muted)' }}>Конфликты города</span>
                  <strong style={{ color: (status.cityMismatchCount ?? 0) > 0 ? '#fca5a5' : 'var(--ly-success)' }}>
                    {status.cityMismatchCount ?? 0}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: 'var(--ly-muted)' }}>Последний sync</span>
                  <strong>{formatTime(status.lastSyncTime)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: 'var(--ly-muted)' }}>Последний автосбор</span>
                  <strong>{formatTime(status.lastAutoCaptureAt ?? null)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: 'var(--ly-muted)' }}>Последний дособор</span>
                  <strong>{formatTime(status.lastEnrichmentAt ?? null)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--ly-muted)' }}>Ошибки отправки</span>
                  <strong style={{ color: status.flushFailures ? '#fca5a5' : 'var(--ly-success)' }}>
                    {status.flushFailures ?? 0}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6 }}>
                  <span style={{ color: 'var(--ly-muted)' }}>Dead-letter</span>
                  <strong style={{ color: (status.deadLetterCount ?? 0) > 0 ? '#fbbf24' : 'var(--ly-success)' }}>
                    {status.deadLetterCount ?? 0}
                  </strong>
                </div>
              </div>
            </section>

            <section className="ly-section">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <h2 className="ly-section-title" style={{ marginBottom: 0 }}>
                  Журнал
                </h2>
                <button
                  type="button"
                  className="ly-btn ly-btn--ghost"
                  style={{ width: 'auto', marginLeft: 'auto', padding: '6px 10px', fontSize: 11 }}
                  onClick={handleCopyDiagnostics}
                >
                  Копировать диагностику
                </button>
              </div>
              <div className="ly-log">
                {(status.recentEvents ?? []).length === 0 ? (
                  <span style={{ color: 'var(--ly-muted)', fontSize: 11 }}>Пока нет событий</span>
                ) : (
                  (status.recentEvents ?? []).slice(0, 14).map((ev, idx) => (
                    <div
                      key={`${ev.at}-${idx}`}
                      className={
                        ev.level === 'error'
                          ? 'ly-log-line--err'
                          : ev.level === 'warn'
                            ? 'ly-log-line--warn'
                            : 'ly-log-line--info'
                      }
                      style={{ marginBottom: 4 }}
                    >
                      {new Date(ev.at).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}{' '}
                      · {ev.message}
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>

      <footer className="ly-footer">
        Leadiya {version ? `v${version}` : ''} · 2GIS → ваша база лидов
      </footer>
    </div>
  )
}

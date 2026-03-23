import React, { useEffect, useState, useCallback } from 'react'

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
type Status = { sessionCount: number; lastSyncTime: string | null; queueSize: number }

const s = {
  body: { width: 400, minHeight: 480, background: '#111', color: '#e5e5e5', fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, margin: 0, padding: 0 } as React.CSSProperties,
  header: { padding: '14px 16px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 10 } as React.CSSProperties,
  logo: { fontSize: 16, fontWeight: 700, color: '#10b981', letterSpacing: -0.5 } as React.CSSProperties,
  badge: { marginLeft: 'auto', background: '#10b981', color: '#000', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 } as React.CSSProperties,
  section: { padding: '12px 16px', borderBottom: '1px solid #1a1a1a' } as React.CSSProperties,
  sectionTitle: { fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1.5, color: '#666', marginBottom: 8 },
  input: { width: '100%', padding: '8px 10px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#e5e5e5', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const },
  select: { width: '100%', padding: '8px 10px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#e5e5e5', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const },
  btn: { width: '100%', padding: '10px', background: '#10b981', color: '#000', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  btnSecondary: { width: '100%', padding: '10px', background: '#222', color: '#ccc', border: '1px solid #333', borderRadius: 6, fontSize: 13, cursor: 'pointer' } as React.CSSProperties,
  row: { display: 'flex', gap: 8, marginBottom: 8 } as React.CSSProperties,
  statusRow: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 12, color: '#888' } as React.CSSProperties,
  statusVal: { color: '#10b981', fontWeight: 600 } as React.CSSProperties,
  toggle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as React.CSSProperties,
  msg: (ok: boolean) => ({ padding: '8px 10px', borderRadius: 6, fontSize: 12, marginTop: 8, background: ok ? '#052e16' : '#3b0000', color: ok ? '#4ade80' : '#f87171' }) as React.CSSProperties,
}

export default function App() {
  const [apiUrl, setApiUrl] = useState('http://localhost:3001')
  const [city, setCity] = useState('Алматы')
  const [category, setCategory] = useState('')
  const [directUrl, setDirectUrl] = useState('')
  const [autoMode, setAutoMode] = useState(false)
  const [status, setStatus] = useState<Status>({ sessionCount: 0, lastSyncTime: null, queueSize: 0 })
  const [pageType, setPageType] = useState<PageType | null>(null)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)

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
        if (resp) setPageType(resp)
      })
    })
  }, [])

  useEffect(() => {
    chrome.storage.local.get(['apiUrl', 'autoMode'], (result) => {
      if (result.apiUrl) setApiUrl(result.apiUrl)
      if (result.autoMode !== undefined) setAutoMode(result.autoMode)
    })
    refreshStatus()
    detectPage()
    const interval = setInterval(refreshStatus, 2000)

    const progressListener = (msg: any) => {
      if (msg.action === 'bulkProgress') {
        setBulkProgress({ done: msg.done, total: msg.total })
      }
    }
    chrome.runtime.onMessage.addListener(progressListener)

    return () => {
      clearInterval(interval)
      chrome.runtime.onMessage.removeListener(progressListener)
    }
  }, [refreshStatus, detectPage])

  const saveApiUrl = () => {
    chrome.storage.local.set({ apiUrl })
    flash('API URL saved', true)
  }

  const toggleAutoMode = () => {
    const next = !autoMode
    setAutoMode(next)
    chrome.storage.local.set({ autoMode: next })
    flash(next ? 'Auto-mode ON' : 'Auto-mode OFF', true)
  }

  const flash = (text: string, ok: boolean) => {
    setMessage({ text, ok })
    setTimeout(() => setMessage(null), 3000)
  }

  const handleScrapeCurrentPage = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return
      setBusy(true)
      chrome.runtime.sendMessage(
        { action: 'manualExtract', tabId: tabs[0].id, city, category },
        (resp) => {
          setBusy(false)
          if (resp?.ok) {
            flash(`Extracted: ${resp.lead.name}`, true)
            refreshStatus()
          } else {
            flash(resp?.error || 'Extraction failed', false)
          }
        }
      )
    })
  }

  const handleBulkScrape = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return
      setBusy(true)
      setBulkProgress({ done: 0, total: 0 })
      chrome.runtime.sendMessage(
        { action: 'bulkScrape', tabId: tabs[0].id, city, category },
        (resp) => {
          setBusy(false)
          setBulkProgress(null)
          if (resp?.ok) {
            flash(`Bulk scrape done: ${resp.extracted} leads`, true)
            refreshStatus()
          } else {
            flash('Bulk scrape failed', false)
          }
        }
      )
    })
  }

  const handleNavigateAndScrape = () => {
    if (!directUrl && !category) return
    const url = directUrl || `https://2gis.kz/${CITY_SLUGS[city] || 'almaty'}/search/${encodeURIComponent(category)}`
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return
      chrome.tabs.update(tabs[0].id, { url })
      flash('Navigating... use Scrape after page loads', true)
    })
  }

  const formatTime = (iso: string | null) => {
    if (!iso) return 'Never'
    const d = new Date(iso)
    return d.toLocaleTimeString()
  }

  return (
    <div style={s.body}>
      <div style={s.header}>
        <span style={s.logo}>Leadiya</span>
        <span style={{ fontSize: 11, color: '#666' }}>Lead Scraper</span>
        <span style={s.badge}>{status.sessionCount}</span>
      </div>

      {/* Status */}
      <div style={s.section}>
        <div style={s.statusRow}>
          <span>Leads this session</span>
          <span style={s.statusVal}>{status.sessionCount}</span>
        </div>
        <div style={s.statusRow}>
          <span>Queue</span>
          <span style={s.statusVal}>{status.queueSize}</span>
        </div>
        <div style={s.statusRow}>
          <span>Last sync</span>
          <span style={{ color: '#aaa' }}>{formatTime(status.lastSyncTime)}</span>
        </div>
        {pageType && (
          <div style={s.statusRow}>
            <span>Current page</span>
            <span style={{ color: pageType.isFirm ? '#10b981' : pageType.isSearch ? '#facc15' : '#666' }}>
              {pageType.isFirm ? 'Firm page' : pageType.isSearch ? 'Search page' : 'Other'}
            </span>
          </div>
        )}
      </div>

      {/* Quick Scrape */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Quick Scrape</div>
        <div style={s.row}>
          <select style={{ ...s.select, flex: 1 }} value={city} onChange={(e) => setCity(e.target.value)}>
            {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 8 }}>
          <input
            style={s.input}
            placeholder="Category (e.g. IT-компании)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 8 }}>
          <input
            style={s.input}
            placeholder="Or paste 2GIS URL directly"
            value={directUrl}
            onChange={(e) => setDirectUrl(e.target.value)}
          />
        </div>

        {pageType?.isFirm && (
          <button style={s.btn} disabled={busy} onClick={handleScrapeCurrentPage}>
            {busy ? 'Extracting...' : 'Extract This Firm'}
          </button>
        )}

        {pageType?.isSearch && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button style={s.btn} disabled={busy} onClick={handleBulkScrape}>
              {busy
                ? bulkProgress
                  ? `Scraping ${bulkProgress.done}/${bulkProgress.total}...`
                  : 'Starting bulk...'
                : 'Bulk Scrape All Firms'}
            </button>
          </div>
        )}

        {!pageType?.isFirm && !pageType?.isSearch && (
          <button
            style={s.btn}
            disabled={!category && !directUrl}
            onClick={handleNavigateAndScrape}
          >
            Navigate to 2GIS
          </button>
        )}

        {message && <div style={s.msg(message.ok)}>{message.text}</div>}
      </div>

      {/* Auto-mode */}
      <div style={s.section}>
        <div style={s.toggle}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Auto-extract mode</div>
            <div style={{ fontSize: 11, color: '#666' }}>Auto-capture when visiting firm pages</div>
          </div>
          <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22 }}>
            <input
              type="checkbox"
              checked={autoMode}
              onChange={toggleAutoMode}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span
              style={{
                position: 'absolute', cursor: 'pointer', inset: 0, borderRadius: 11,
                background: autoMode ? '#10b981' : '#333',
                transition: 'background 0.2s',
              }}
            >
              <span
                style={{
                  position: 'absolute', height: 16, width: 16, left: autoMode ? 20 : 4, bottom: 3,
                  background: '#fff', borderRadius: '50%', transition: 'left 0.2s',
                }}
              />
            </span>
          </label>
        </div>
      </div>

      {/* Settings */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Settings</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            style={{ ...s.input, flex: 1 }}
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="API URL"
          />
          <button
            style={{ ...s.btnSecondary, width: 'auto', padding: '8px 14px', whiteSpace: 'nowrap' }}
            onClick={saveApiUrl}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

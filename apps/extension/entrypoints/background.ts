import { defineBackground } from 'wxt/utils/define-background'
import { DEFAULT_LOCAL_API_ORIGIN } from '../lib/local-api-default'
import { dashboardUrlFromApi } from '../lib/dashboard-url'
import { leadsToCsv, leadsToJsonPretty } from '../lib/lead-export'
import type { DeadLetterLead, LeadPayload, QueuedLead } from '../lib/lead-types'
import { normalizeApiOrigin, pruneRecent, shouldEnqueueLead } from '../lib/lead-queue'
import { loadSinkSettings } from '../lib/sink-settings'
import { flushAllSinks } from '../lib/sinks/flush-sinks'
import { clearDeadLetters, loadDeadLetters } from '../lib/sinks/dead-letter'
import { applySinkEvent, defaultSinkHealth, withRetryPending } from '../lib/sinks/sink-health'
import { collectWebsiteContacts, normalizeWebsiteUrl } from '../lib/website-follow'
import { resolveCategory, resolveLeadCategory } from '../lib/category'
import { resolveCity, resolveCityFromAddress } from '../lib/city'
import { buildSearchPageUrl } from '../lib/search-pagination'

const DEFAULT_API_URL = DEFAULT_LOCAL_API_ORIGIN
const BATCH_INTERVAL_MS = 5_000
const RECENT_DEDUP_WINDOW_MS = 10 * 60 * 1_000
const WEBSITE_FOLLOW_MAX_PAGES = 3
const WEBSITE_FOLLOW_TIMEOUT_MS = 5_000
const EVENT_LOG_LIMIT = 30
const PERSIST_QUEUE_KEY = 'persistedQueueV1'

let leadQueue: QueuedLead[] = []
let sessionCount = 0
let lastSyncTime: string | null = null
let batchTimer: ReturnType<typeof setInterval> | null = null
let flushFailures = 0
let lastError: string | null = null
const recentLeadKeys = new Map<string, number>()
const websiteCache = new Map<string, { at: number; phones: string[]; emails: string[] }>()
const recentEvents: { at: string; level: 'info' | 'warn' | 'error'; message: string }[] = []
let bulkRunning = false
let bulkCancelRequested = false
let bulkDone = 0
let bulkTotal = 0
let autoCaptures = 0
let lastAutoCaptureAt: string | null = null
let lastEnrichmentAt: string | null = null
let lastEnrichmentStatus: 'idle' | 'success' | 'warn' = 'idle'
let cityMismatchCount = 0
let lastCityMismatchAt: string | null = null
let sinkHealth = defaultSinkHealth()

let persistTimer: ReturnType<typeof setTimeout> | null = null

function migrateQueue(raw: unknown): QueuedLead[] {
  if (!Array.isArray(raw)) return []
  const out: QueuedLead[] = []
  for (const item of raw) {
    if (item && typeof item === 'object' && 'lead' in item && 'id' in item) {
      const q = item as QueuedLead
      out.push({
        id: String(q.id),
        lead: q.lead,
        delivered: { ...q.delivered },
        deliveryMeta: { ...(q.deliveryMeta || {}) },
      })
      continue
    }
    if (item && typeof item === 'object' && 'name' in item) {
      out.push({
        id: crypto.randomUUID(),
        lead: item as LeadPayload,
        delivered: {},
      })
    }
  }
  return out
}

function schedulePersistQueue() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void chrome.storage.local.set({ [PERSIST_QUEUE_KEY]: leadQueue })
  }, 400)
}

function resolveTabId(message: { tabId?: number }, sender: chrome.runtime.MessageSender): number | undefined {
  if (typeof message.tabId === 'number' && message.tabId > 0) return message.tabId
  return sender.tab?.id
}

function safeBroadcast(message: unknown) {
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError
    })
  } catch {
    // ignore
  }
}

function pushEvent(level: 'info' | 'warn' | 'error', message: string) {
  recentEvents.unshift({ at: new Date().toISOString(), level, message })
  if (recentEvents.length > EVENT_LOG_LIMIT) recentEvents.pop()
  if (level === 'error') lastError = message
}

function maskPhoneForLog(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) return phone
  return `***${digits.slice(-4)}`
}

function notify(title: string, message: string) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icon/128.png',
      title,
      message,
    })
  } catch {
    // ignore
  }
}

async function isWebsiteFollowEnabled(): Promise<boolean> {
  const r = await chrome.storage.local.get('websiteFollow')
  if (typeof r.websiteFollow === 'boolean') return r.websiteFollow
  return true
}

async function enrichLeadFromWebsite(lead: LeadPayload): Promise<LeadPayload> {
  const website = normalizeWebsiteUrl(lead.website || '')
  if (!website) {
    lastEnrichmentAt = new Date().toISOString()
    lastEnrichmentStatus = 'warn'
    pushEvent('info', 'Дособор: у компании нет сайта')
    return lead
  }
  if (!(await isWebsiteFollowEnabled())) {
    lastEnrichmentAt = new Date().toISOString()
    lastEnrichmentStatus = 'warn'
    pushEvent('info', 'Дособор: выключен в настройках')
    return lead
  }

  const cached = websiteCache.get(website)
  const now = Date.now()
  if (cached && now - cached.at < 30 * 60 * 1_000) {
    pushEvent('info', `Сайт (кэш): ${website}`)
    lastEnrichmentAt = new Date().toISOString()
    lastEnrichmentStatus = 'success'
    return {
      ...lead,
      phones: Array.from(new Set([...(lead.phones || []), ...cached.phones])),
      emails: Array.from(new Set([...(lead.emails || []), ...cached.emails])),
    }
  }

  const fromSite = await collectWebsiteContacts(website, {
    maxPages: WEBSITE_FOLLOW_MAX_PAGES,
    timeoutMs: WEBSITE_FOLLOW_TIMEOUT_MS,
  })

  if (fromSite.error) {
    console.warn(`[Leadiya] Website follow warning for ${website}: ${fromSite.error}`)
    pushEvent('warn', `Сайт ${website}: ${fromSite.error}`)
    lastEnrichmentStatus = 'warn'
  } else {
    pushEvent('info', `Сайт ${website}: +${fromSite.emails.length} email, +${fromSite.phones.length} тел.`)
    lastEnrichmentStatus = 'success'
  }
  lastEnrichmentAt = new Date().toISOString()

  websiteCache.set(website, { at: now, phones: fromSite.phones, emails: fromSite.emails })
  return {
    ...lead,
    phones: Array.from(new Set([...(lead.phones || []), ...fromSite.phones])),
    emails: Array.from(new Set([...(lead.emails || []), ...fromSite.emails])),
  }
}

async function getApiUrl(): Promise<string> {
  const result = await chrome.storage.local.get('apiUrl')
  return result.apiUrl || DEFAULT_API_URL
}

async function flushQueue(): Promise<{ inserted: number; skipped: number } | null> {
  if (leadQueue.length === 0) return null

  const settings = await loadSinkSettings()
  const apiUrlRaw = await getApiUrl()
  const apiUrl = normalizeApiOrigin(apiUrlRaw)

  const enabledAuto =
    (settings.sinkApiEnabled && apiUrl) ||
    (settings.sinkWebhookEnabled && settings.webhookUrl) ||
    (settings.sinkSheetsEnabled && settings.spreadsheetId)

  if (!enabledAuto) {
    return null
  }

  const beforeLen = leadQueue.length
  let hadError = false
  leadQueue = await flushAllSinks(leadQueue, {
    apiUrl: apiUrlRaw,
    settings,
    onEvent: (level, msg) => {
      if (level === 'error') hadError = true
      sinkHealth = applySinkEvent(sinkHealth, level, msg)
      pushEvent(level, msg)
    },
    lastSyncTimeSetter: (iso) => {
      lastSyncTime = iso
    },
  })

  schedulePersistQueue()

  if (hadError) {
    flushFailures++
  } else if (leadQueue.length < beforeLen) {
    flushFailures = 0
    lastError = null
  }

  const processed = beforeLen - leadQueue.length
  return processed > 0 ? { inserted: processed, skipped: 0 } : null
}

async function getDeadLetterCount(): Promise<number> {
  const dead = await loadDeadLetters()
  return dead.length
}

function enqueueLead(lead: LeadPayload) {
  pruneRecent(recentLeadKeys, Date.now(), RECENT_DEDUP_WINDOW_MS)
  if (!shouldEnqueueLead(lead, recentLeadKeys, Date.now(), RECENT_DEDUP_WINDOW_MS)) {
    pushEvent('info', `Дубликат пропущен: ${lead.name}`)
    return
  }
  leadQueue.push({ id: crypto.randomUUID(), lead, delivered: {} })
  sessionCount++
  void chrome.storage.local.set({ sessionCount })
  pushEvent('info', `Добавлен в очередь: ${lead.name}`)
  schedulePersistQueue()
}

async function withResolvedCategory(
  lead: LeadPayload,
  contextCategory?: string
): Promise<LeadPayload> {
  return {
    ...lead,
    category: resolveLeadCategory(lead.name, contextCategory, lead.category),
  }
}

async function withResolvedGeo(
  lead: LeadPayload,
  contextCity?: string,
  contextCategory?: string
): Promise<LeadPayload> {
  const withCategory = await withResolvedCategory(lead, contextCategory)
  const contextNorm = contextCity ? resolveCity(contextCity) : undefined
  const extractedNorm = withCategory.city ? resolveCity(withCategory.city) : undefined
  const cityFromAddress = resolveCityFromAddress(withCategory.address)
  if (contextNorm && cityFromAddress && contextNorm !== cityFromAddress) {
    cityMismatchCount += 1
    lastCityMismatchAt = new Date().toISOString()
    pushEvent('warn', `Город конфликт: запуск=${contextNorm}, адрес=${cityFromAddress}, лид=${withCategory.name}`)
  }

  if (extractedNorm && cityFromAddress && extractedNorm !== cityFromAddress) {
    cityMismatchCount += 1
    lastCityMismatchAt = new Date().toISOString()
    pushEvent('warn', `Город конфликт: карточка=${extractedNorm}, адрес=${cityFromAddress}, лид=${withCategory.name}`)
  }

  const resolvedCity = cityFromAddress || resolveCity(contextCity, withCategory.city)
  return {
    ...withCategory,
    city: resolvedCity,
  }
}

async function extractFromTab(tabId: number): Promise<LeadPayload | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'extractFirm' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        resolve(null)
        return
      }
      resolve(response.data)
    })
  })
}

async function waitTabComplete(tabId: number, timeoutMs = 15000): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete') return
  } catch {
    // continue
  }
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error('Таймаут загрузки вкладки'))
    }, timeoutMs)
    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(t)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function sendToContentWithTimeout<TResp = unknown>(
  tabId: number,
  message: unknown,
  timeoutMs = 12000
): Promise<TResp> {
  return new Promise<TResp>((resolve, reject) => {
    let settled = false
    const t = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('Таймаут ответа content-script'))
    }, timeoutMs)
    chrome.tabs.sendMessage(tabId, message as never, (response) => {
      if (settled) return
      settled = true
      clearTimeout(t)
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'Ошибка связи с вкладкой'))
        return
      }
      resolve(response as TResp)
    })
  })
}

async function sendToContentWithRetry<TResp = unknown>(
  tabId: number,
  message: unknown,
  totalTimeoutMs = 18000
): Promise<TResp> {
  const started = Date.now()
  let attempt = 0
  let lastErr: string | null = null
  while (Date.now() - started < totalTimeoutMs) {
    attempt += 1
    try {
      return await sendToContentWithTimeout<TResp>(tabId, message, 4500)
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
      await new Promise((r) => setTimeout(r, Math.min(1200, 250 * attempt)))
    }
  }
  throw new Error(lastErr || 'Не удалось получить ответ content-script')
}

async function bulkScrape(
  tabId: number,
  city: string,
  category: string,
  maxPages: number,
  onProgress: (done: number, total: number) => void
): Promise<number> {
  bulkRunning = true
  bulkCancelRequested = false
  bulkDone = 0
  bulkTotal = 0
  pushEvent('info', 'Bulk запущен')
  notify('Leadiya', 'Массовый сбор запущен')
  let linksResponse: { success: boolean; links?: string[]; debug?: string[] } = { success: false }
  try {
    const sourceTab = await chrome.tabs.get(tabId)
    const sourceUrl = sourceTab.url || ''
    const allLinks = new Set<string>()
    const allDebug: string[] = []

    if (/2gis\./i.test(sourceUrl) && /\/search\//.test(sourceUrl)) {
      for (let page = 1; page <= maxPages; page++) {
        const pageUrl = buildSearchPageUrl(sourceUrl, page)
        const collectorTab = await chrome.tabs.create({ url: pageUrl, active: false })
        const collectorTabId = collectorTab.id
        if (!collectorTabId) continue
        try {
          await waitTabComplete(collectorTabId, 20000)
          const resp = await sendToContentWithRetry<{ success: boolean; links?: string[]; debug?: string[] }>(
            collectorTabId,
            { action: 'collectFirmLinks', maxPages: 1 },
            20000
          )
          const links = resp.links || []
          links.forEach((l) => allLinks.add(l))
          allDebug.push(`page=${page} links=${links.length} url=${pageUrl}`)
          for (const d of resp.debug || []) allDebug.push(`page=${page} ${d}`)
          if (page > 1 && links.length === 0) break
        } finally {
          try {
            await chrome.tabs.remove(collectorTabId)
          } catch {
            // ignore
          }
        }
      }
    } else {
      const resp = await sendToContentWithRetry<{ success: boolean; links?: string[]; debug?: string[] }>(
        tabId,
        { action: 'collectFirmLinks', maxPages: 1 },
        20000
      )
      for (const l of resp.links || []) allLinks.add(l)
      allDebug.push(...(resp.debug || []))
    }

    linksResponse = {
      success: allLinks.size > 0,
      links: Array.from(allLinks),
      debug: allDebug,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    pushEvent('warn', `Bulk: не удалось собрать ссылки (${msg})`)
    linksResponse = { success: false }
  }

  if (!linksResponse.success || !linksResponse.links?.length) {
    bulkRunning = false
    bulkDone = 0
    bulkTotal = 0
    pushEvent('warn', 'Bulk: на странице не найдены карточки')
    notify('Leadiya', 'Bulk остановлен: карточки не найдены')
    throw new Error('Карточки для сбора не найдены (проверьте страницу/фильтры)')
  }

  const firmLinks = linksResponse.links
  for (const line of linksResponse.debug || []) {
    pushEvent('info', `Bulk dbg: ${line}`)
  }
  pushEvent('info', `Bulk dbg: links=${firmLinks.length}`)
  bulkTotal = firmLinks.length
  let extracted = 0

  for (let i = 0; i < firmLinks.length; i++) {
    if (bulkCancelRequested) {
      pushEvent('warn', 'Bulk остановлен пользователем')
      notify('Leadiya', 'Массовый сбор остановлен')
      break
    }
    try {
      const newTab = await chrome.tabs.create({ url: firmLinks[i], active: false })
      if (!newTab.id) continue

      await waitTabComplete(newTab.id, 20000)

      await new Promise((r) => setTimeout(r, 1500))

      const data = await extractFromTab(newTab.id)
      if (data?.name) {
        if ((data.phones || []).length <= 1) {
          const extractedPhones = data.phones || []
          const first = extractedPhones[0] ? maskPhoneForLog(extractedPhones[0]) : 'none'
          pushEvent('warn', `Bulk телефоны=${extractedPhones.length} первый=${first} url=${data.sourceUrl}`)
        }
        data.city = city
        data.category = category
        const normalized = await withResolvedGeo(data, city, category)
        enqueueLead(normalized)
        extracted++
      }

      await chrome.tabs.remove(newTab.id)
      bulkDone = i + 1
      onProgress(i + 1, firmLinks.length)
    } catch (err) {
      console.error(`[Leadiya] Error scraping ${firmLinks[i]}:`, err)
    }
  }

  await flushQueue()
  if (!bulkCancelRequested) {
    notify('Leadiya', `Массовый сбор завершен: ${extracted}`)
  }
  bulkRunning = false
  bulkCancelRequested = false
  bulkDone = 0
  bulkTotal = 0
  return extracted
}

export default defineBackground(() => {
  console.log('[Leadiya] Background script started')

  chrome.storage.local.get([PERSIST_QUEUE_KEY, 'sessionCount', 'lastSyncTime'], (result) => {
    leadQueue = migrateQueue(result[PERSIST_QUEUE_KEY])
    sessionCount = result.sessionCount || 0
    lastSyncTime = result.lastSyncTime || null
  })

  batchTimer = setInterval(() => {
    void flushQueue()
  }, BATCH_INTERVAL_MS)

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'autoExtracted' && message.data) {
      const extractedPhones = (message.data as LeadPayload).phones || []
      if (extractedPhones.length <= 1) {
        const first = extractedPhones[0] ? maskPhoneForLog(extractedPhones[0]) : 'none'
        pushEvent('warn', `Телефоны извлечено=${extractedPhones.length} первый=${first} url=${(message.data as LeadPayload).sourceUrl}`)
      }
      withResolvedGeo(message.data as LeadPayload)
        .then((prepared) => enrichLeadFromWebsite(prepared))
        .then((enriched) => {
          autoCaptures += 1
          lastAutoCaptureAt = new Date().toISOString()
          pushEvent('info', `Автопилот: захвачено (${autoCaptures})`)
          enqueueLead(enriched)
          sendResponse({ ok: true })
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err)
          lastError = msg
          pushEvent('warn', `Автопилот: ${msg}`)
          withResolvedGeo(message.data as LeadPayload).then((prepared) => enqueueLead(prepared))
          sendResponse({ ok: true, warning: msg })
        })
      return true
    }

    if (message.action === 'openDashboard') {
      void getApiUrl().then((apiUrl) => {
        chrome.tabs.create({ url: dashboardUrlFromApi(apiUrl) })
      })
      sendResponse({ ok: true })
      return true
    }

    if (message.action === 'exportLeads') {
      const fmt = (message as { format?: string }).format === 'json' ? 'json' : 'csv'
      const leads = leadQueue.map((q) => q.lead)
      if (leads.length === 0) {
        sendResponse({ ok: false, error: 'Очередь пуста' })
        return true
      }
      const content = fmt === 'csv' ? leadsToCsv(leads) : leadsToJsonPretty(leads)
      const mime = fmt === 'csv' ? 'text/csv' : 'application/json'
      const ext = fmt === 'csv' ? 'csv' : 'json'
      const url = `data:${mime};charset=utf-8,${encodeURIComponent(content)}`
      const filename = `leadiya-leads-${Date.now()}.${ext}`
      chrome.downloads.download({ url, filename, saveAs: true }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message })
        } else {
          pushEvent('info', `Экспорт: ${filename}`)
          sendResponse({ ok: true })
        }
      })
      return true
    }

    if (message.action === 'manualExtract') {
      const tabId = resolveTabId(message, sender)
      const { city, category } = message as { city?: string; category?: string }
      if (!tabId) {
        sendResponse({ ok: false, error: 'Не удалось определить вкладку' })
        return true
      }
      extractFromTab(tabId).then((data) => {
        if (data?.name) {
          if ((data.phones || []).length <= 1) {
            const extractedPhones = data.phones || []
            const first = extractedPhones[0] ? maskPhoneForLog(extractedPhones[0]) : 'none'
            pushEvent('warn', `Ручной сбор телефоны=${extractedPhones.length} первый=${first} url=${data.sourceUrl}`)
          }
          if (city && !data.city) data.city = city
          withResolvedGeo(data, city, category)
            .then((prepared) => enrichLeadFromWebsite(prepared))
            .then((enriched) => {
              enqueueLead(enriched)
              return flushQueue().then(() => ({ enriched }))
            })
            .then(({ enriched }) => {
              sendResponse({ ok: true, lead: enriched })
            })
            .catch((err) => {
              const msg = err instanceof Error ? err.message : String(err)
              lastError = msg
              pushEvent('warn', `Ручной сбор: ${msg}`)
              withResolvedGeo(data, city, category).then((prepared) => {
                enqueueLead(prepared)
                flushQueue().finally(() => sendResponse({ ok: true, lead: prepared, warning: msg }))
              })
            })
        } else {
          sendResponse({ ok: false, error: 'Не удалось извлечь данные' })
        }
      })
      return true
    }

    if (message.action === 'bulkScrape') {
      const tabId = resolveTabId(message, sender)
      const { city, category } = message as { city?: string; category?: string }
      if (!tabId) {
        sendResponse({ ok: false, error: 'Не удалось определить вкладку' })
        return true
      }
      const maxPages = Number(message.maxPages ?? 3)
      const resolvedCategory = resolveCategory(category)
      bulkScrape(tabId, city, resolvedCategory, Number.isFinite(maxPages) ? maxPages : 3, (done, total) => {
        safeBroadcast({ action: 'bulkProgress', done, total })
      })
        .then((count) => {
          pushEvent('info', `Bulk: собрано ${count}`)
          sendResponse({ ok: true, extracted: count })
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err)
          lastError = msg
          flushFailures++
          pushEvent('error', `Bulk ошибка: ${msg}`)
          notify('Leadiya', `Ошибка bulk: ${msg}`)
          bulkRunning = false
          bulkCancelRequested = false
          bulkDone = 0
          bulkTotal = 0
          sendResponse({ ok: false, error: msg })
        })
      return true
    }

    if (message.action === 'stopBulk') {
      bulkCancelRequested = true
      pushEvent('warn', 'Запрошена остановка bulk')
      sendResponse({ ok: true })
      return true
    }

    if (message.action === 'websiteFollowOnly') {
      const tabId = resolveTabId(message, sender)
      const { city, category } = message as { city?: string; category?: string }
      if (!tabId) {
        sendResponse({ ok: false, error: 'Не удалось определить вкладку' })
        return true
      }
      extractFromTab(tabId).then((data) => {
        if (!data?.name) {
          sendResponse({ ok: false, error: 'Не удалось извлечь данные' })
          return
        }
        if (city && !data.city) data.city = city
        withResolvedGeo(data, city, category)
          .then((prepared) => enrichLeadFromWebsite(prepared))
          .then((enriched) => {
            enqueueLead(enriched)
            return flushQueue().then(() => enriched)
          })
          .then((enriched) => {
            sendResponse({ ok: true, lead: enriched })
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err)
            lastError = msg
            pushEvent('error', `Дособор сайта: ${msg}`)
            sendResponse({ ok: false, error: msg })
          })
      })
      return true
    }

    if (message.action === 'flushNow') {
      flushQueue().then((result) => {
        sendResponse({ ok: true, result })
      })
      return true
    }

    if (message.action === 'getStatus') {
      getDeadLetterCount().then((deadLetterCount) => {
        const sinkHealthSnapshot = withRetryPending(sinkHealth, leadQueue)
        sendResponse({
          sessionCount,
          lastSyncTime,
          queueSize: leadQueue.length,
          deadLetterCount,
          flushFailures,
          lastError,
          recentEvents,
          bulkRunning,
          bulkDone,
          bulkTotal,
          autoCaptures,
          lastAutoCaptureAt,
          lastEnrichmentAt,
          lastEnrichmentStatus,
          cityMismatchCount,
          lastCityMismatchAt,
          sinkHealth: sinkHealthSnapshot,
        })
      })
      return true
    }

    if (message.action === 'retryDeadLetters') {
      loadDeadLetters()
        .then((dead) => {
          const byId = new Map<string, DeadLetterLead>()
          for (const item of dead) {
            if (!byId.has(item.id)) byId.set(item.id, item)
          }
          const items = Array.from(byId.values())
          for (const item of items) {
            leadQueue.push({
              id: item.id,
              lead: item.lead,
              delivered: {},
              deliveryMeta: {},
            })
          }
          return clearDeadLetters().then(() => items.length)
        })
        .then((count) => {
          schedulePersistQueue()
          pushEvent('info', `Повтор dead-letter: ${count}`)
          sendResponse({ ok: true, count })
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err)
          sendResponse({ ok: false, error: msg })
        })
      return true
    }

    if (message.action === 'clearDeadLetters') {
      clearDeadLetters()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err)
          sendResponse({ ok: false, error: msg })
        })
      return true
    }

    if (message.action === 'resetSession') {
      sessionCount = 0
      leadQueue = []
      flushFailures = 0
      lastError = null
      recentEvents.length = 0
      autoCaptures = 0
      lastAutoCaptureAt = null
      lastEnrichmentAt = null
      lastEnrichmentStatus = 'idle'
      cityMismatchCount = 0
      lastCityMismatchAt = null
      sinkHealth = defaultSinkHealth()
      void chrome.storage.local.set({ sessionCount: 0, [PERSIST_QUEUE_KEY]: [] }).then(() => clearDeadLetters())
      sendResponse({ ok: true })
      return true
    }

    return false
  })
})

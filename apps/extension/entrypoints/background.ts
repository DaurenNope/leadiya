import { defineBackground } from 'wxt/utils/define-background'

interface LeadPayload {
  name: string
  address: string
  phones: string[]
  emails: string[]
  website: string
  instagram: string
  whatsapp: string
  telegram: string
  facebook: string
  rating: number | null
  bin: string
  lat: string
  lng: string
  sourceUrl: string
  city?: string
  category?: string
}

const DEFAULT_API_URL = 'http://localhost:3001'
const BATCH_INTERVAL_MS = 5_000

let leadQueue: LeadPayload[] = []
let sessionCount = 0
let lastSyncTime: string | null = null
let batchTimer: ReturnType<typeof setInterval> | null = null

async function getApiUrl(): Promise<string> {
  const result = await chrome.storage.local.get('apiUrl')
  return result.apiUrl || DEFAULT_API_URL
}

async function flushQueue(): Promise<{ inserted: number; skipped: number } | null> {
  if (leadQueue.length === 0) return null

  const batch = leadQueue.splice(0, leadQueue.length)
  const apiUrl = await getApiUrl()

  try {
    const resp = await fetch(`${apiUrl}/api/leads/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: batch }),
    })

    if (!resp.ok) {
      console.error('[Leadiya] API error:', resp.status, await resp.text())
      leadQueue.push(...batch)
      return null
    }

    const result = await resp.json()
    lastSyncTime = new Date().toISOString()
    await chrome.storage.local.set({ lastSyncTime })
    console.log(`[Leadiya] Synced ${result.inserted} inserted, ${result.skipped} skipped`)
    return result
  } catch (err) {
    console.error('[Leadiya] Failed to push leads:', err)
    leadQueue.push(...batch)
    return null
  }
}

function enqueueLead(lead: LeadPayload) {
  leadQueue.push(lead)
  sessionCount++
  chrome.storage.local.set({ sessionCount })
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

async function bulkScrape(
  tabId: number,
  city: string,
  category: string,
  onProgress: (done: number, total: number) => void
): Promise<number> {
  const linksResponse = await new Promise<{ success: boolean; links?: string[] }>((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'collectFirmLinks' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        resolve({ success: false })
        return
      }
      resolve(response)
    })
  })

  if (!linksResponse.success || !linksResponse.links?.length) return 0

  const firmLinks = linksResponse.links
  let extracted = 0

  for (let i = 0; i < firmLinks.length; i++) {
    try {
      const newTab = await chrome.tabs.create({ url: firmLinks[i], active: false })
      if (!newTab.id) continue

      await new Promise<void>((resolve) => {
        const listener = (
          updatedTabId: number,
          info: chrome.tabs.TabChangeInfo
        ) => {
          if (updatedTabId === newTab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener)
            resolve()
          }
        }
        chrome.tabs.onUpdated.addListener(listener)
      })

      await new Promise((r) => setTimeout(r, 1500))

      const data = await extractFromTab(newTab.id)
      if (data?.name) {
        data.city = city
        data.category = category
        enqueueLead(data)
        extracted++
      }

      await chrome.tabs.remove(newTab.id)
      onProgress(i + 1, firmLinks.length)
    } catch (err) {
      console.error(`[Leadiya] Error scraping ${firmLinks[i]}:`, err)
    }
  }

  await flushQueue()
  return extracted
}

export default defineBackground(() => {
  console.log('[Leadiya] Background script started')

  chrome.storage.local.get(['sessionCount', 'lastSyncTime'], (result) => {
    sessionCount = result.sessionCount || 0
    lastSyncTime = result.lastSyncTime || null
  })

  batchTimer = setInterval(flushQueue, BATCH_INTERVAL_MS)

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'autoExtracted' && message.data) {
      enqueueLead(message.data)
      sendResponse({ ok: true })
      return true
    }

    if (message.action === 'manualExtract') {
      const { tabId, city, category } = message
      extractFromTab(tabId).then((data) => {
        if (data?.name) {
          if (city) data.city = city
          if (category) data.category = category
          enqueueLead(data)
          flushQueue().then(() => {
            sendResponse({ ok: true, lead: data })
          })
        } else {
          sendResponse({ ok: false, error: 'Could not extract data' })
        }
      })
      return true
    }

    if (message.action === 'bulkScrape') {
      const { tabId, city, category } = message
      bulkScrape(tabId, city, category, (done, total) => {
        chrome.runtime.sendMessage({ action: 'bulkProgress', done, total }).catch(() => {})
      }).then((count) => {
        sendResponse({ ok: true, extracted: count })
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
      sendResponse({ sessionCount, lastSyncTime, queueSize: leadQueue.length })
      return true
    }

    if (message.action === 'resetSession') {
      sessionCount = 0
      leadQueue = []
      chrome.storage.local.set({ sessionCount: 0 })
      sendResponse({ ok: true })
      return true
    }

    return false
  })
})

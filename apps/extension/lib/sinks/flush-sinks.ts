import { DEFAULT_LOCAL_API_ORIGIN } from '../local-api-default'
import { normalizeApiOrigin } from '../lead-queue'
import { rowFromLeadForSheets } from './sheets-rows'
import type { LeadPayload, QueuedLead, SinkId } from '../lead-types'
import type { SinkSettings } from '../sink-settings'
import { pushDeadLetterFromQueue } from './dead-letter'
import { maxRetriesForSink, nextBackoffMs } from './retry-policy'

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function getAuthTokenInteractive(interactive: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime.lastError || !token) {
          resolve(null)
          return
        }
        resolve(token)
      })
    } catch {
      resolve(null)
    }
  })
}

async function flushApiSink(
  leads: LeadPayload[],
  apiUrl: string,
  serviceKey: string
): Promise<{ ok: boolean; error?: string; inserted?: number; duplicate?: number; rejected?: number }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const trimmed = serviceKey.trim()
  if (trimmed) headers['X-Leadiya-Service-Key'] = trimmed

  try {
    const resp = await fetch(`${apiUrl}/api/leads/bulk`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ leads }),
    })
    if (!resp.ok) {
      const body = await resp.text()
      return { ok: false, error: `API ${resp.status}: ${body.slice(0, 200)}` }
    }
    const payload = await resp.json().catch(() => null)
    const results = Array.isArray(payload?.results) ? payload.results : []
    let inserted = 0
    let duplicate = 0
    let rejected = 0
    for (const r of results) {
      const status = String(r?.status || '')
      if (status === 'inserted') inserted += 1
      else if (status === 'duplicate') duplicate += 1
      else if (status === 'rejected') rejected += 1
    }
    return { ok: true, inserted, duplicate, rejected }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function flushWebhookSink(
  leads: LeadPayload[],
  url: string,
  secret: string
): Promise<{ ok: boolean; error?: string }> {
  const body = JSON.stringify({
    source: 'leadiya-extension',
    sentAt: new Date().toISOString(),
    leads,
  })
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  const trimmed = secret.trim()
  if (trimmed) {
    try {
      headers['X-Leadiya-Signature'] = await hmacSha256Hex(trimmed, body)
    } catch {
      return { ok: false, error: 'HMAC failed' }
    }
  }

  try {
    const resp = await fetch(url, { method: 'POST', headers, body })
    if (!resp.ok) {
      const t = await resp.text()
      return { ok: false, error: `Webhook ${resp.status}: ${t.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function flushSheetsSink(
  leads: LeadPayload[],
  spreadsheetId: string,
  range: string
): Promise<{ ok: boolean; error?: string }> {
  let token = await getAuthTokenInteractive(false)
  if (!token) token = await getAuthTokenInteractive(true)
  if (!token) {
    return { ok: false, error: 'Google auth failed — set OAuth client in build (WXT_GOOGLE_CLIENT_ID)' }
  }

  const values = leads.map((l) => rowFromLeadForSheets(l))
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    })
    if (resp.status === 401) {
      try {
        await new Promise<void>((r) => {
          chrome.identity.removeCachedAuthToken({ token: token! }, () => r())
        })
      } catch {
        // ignore
      }
      return { ok: false, error: 'Google token expired — reopen extension and retry' }
    }
    if (!resp.ok) {
      const t = await resp.text()
      return { ok: false, error: `Sheets ${resp.status}: ${t.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export type FlushContext = {
  apiUrl: string
  settings: SinkSettings
  onEvent: (level: 'info' | 'warn' | 'error', message: string) => void
  lastSyncTimeSetter: (iso: string) => void
}

function cloneQueue(queue: QueuedLead[]): QueuedLead[] {
  return queue.map((q) => ({
    ...q,
    delivered: { ...q.delivered },
    deliveryMeta: { ...(q.deliveryMeta || {}) },
  }))
}

function isReadyForSink(q: QueuedLead, sink: SinkId, now: number): boolean {
  const meta = q.deliveryMeta?.[sink]
  if (!meta?.nextEligibleAt) return true
  return meta.nextEligibleAt <= now
}

function markSinkFailure(remaining: QueuedLead[], sink: SinkId, error: string, now: number): QueuedLead[] {
  return remaining.map((q) => {
    if (q.delivered[sink] || !isReadyForSink(q, sink, now)) return q
    const prev = q.deliveryMeta?.[sink]
    const attempts = (prev?.attempts || 0) + 1
    return {
      ...q,
      deliveryMeta: {
        ...(q.deliveryMeta || {}),
        [sink]: {
          attempts,
          nextEligibleAt: now + nextBackoffMs(sink, attempts),
          lastError: error,
        },
      },
    }
  })
}

async function moveExhaustedToDeadLetters(
  remaining: QueuedLead[],
  enabledSinks: SinkId[],
  onEvent: (level: 'info' | 'warn' | 'error', message: string) => void
): Promise<QueuedLead[]> {
  const keep: QueuedLead[] = []
  for (const q of remaining) {
    const exhausted = enabledSinks.find((sink) => {
      if (q.delivered[sink]) return false
      const attempts = q.deliveryMeta?.[sink]?.attempts || 0
      return attempts >= maxRetriesForSink(sink)
    })
    if (!exhausted) {
      keep.push(q)
      continue
    }
    const reason = q.deliveryMeta?.[exhausted]?.lastError || 'Delivery retries exhausted'
    await pushDeadLetterFromQueue(q, exhausted, reason)
    onEvent('warn', `Dead-letter: ${q.lead.name} (${exhausted})`)
  }
  return keep
}

/** Returns updated queue after attempting each enabled sink. */
export async function flushAllSinks(
  queue: QueuedLead[],
  ctx: FlushContext
): Promise<QueuedLead[]> {
  const { settings } = ctx
  const apiOrigin = normalizeApiOrigin(ctx.apiUrl || DEFAULT_LOCAL_API_ORIGIN)

  const enabledSinks: SinkId[] = []
  if (settings.sinkApiEnabled && apiOrigin) enabledSinks.push('api')
  if (settings.sinkWebhookEnabled && settings.webhookUrl) enabledSinks.push('webhook')
  if (settings.sinkSheetsEnabled && settings.spreadsheetId) enabledSinks.push('sheets')

  if (enabledSinks.length === 0) {
    return queue
  }

  let remaining = cloneQueue(queue)

  const markDelivered = (sink: SinkId, ids: Set<string>) => {
    remaining = remaining.map((q) =>
      ids.has(q.id) ? { ...q, delivered: { ...q.delivered, [sink]: true } } : q
    )
  }

  if (enabledSinks.includes('api') && apiOrigin) {
    const nowMs = Date.now()
    const pending = remaining.filter((q) => !q.delivered.api && isReadyForSink(q, 'api', nowMs))
    if (pending.length > 0) {
      const batch = pending.map((p) => p.lead)
      const r = await flushApiSink(batch, apiOrigin, settings.apiServiceKey)
      if (r.ok) {
        markDelivered('api', new Set(pending.map((p) => p.id)))
        const syncedAt = new Date().toISOString()
        ctx.lastSyncTimeSetter(syncedAt)
        await chrome.storage.local.set({ lastSyncTime: syncedAt })
        const inserted = r.inserted ?? batch.length
        const duplicate = r.duplicate ?? 0
        const rejected = r.rejected ?? 0
        ctx.onEvent('info', `API: inserted=${inserted} duplicate=${duplicate} rejected=${rejected}`)
      } else {
        const err = r.error || 'ошибка'
        remaining = markSinkFailure(remaining, 'api', err, nowMs)
        ctx.onEvent('error', `API: ${err}`)
      }
    }
  }

  if (enabledSinks.includes('webhook')) {
    const now = Date.now()
    const pending = remaining.filter((q) => !q.delivered.webhook && isReadyForSink(q, 'webhook', now))
    if (pending.length > 0) {
      const batch = pending.map((p) => p.lead)
      const r = await flushWebhookSink(batch, settings.webhookUrl, settings.webhookSecret)
      if (r.ok) {
        markDelivered('webhook', new Set(pending.map((p) => p.id)))
        ctx.onEvent('info', `Webhook: отправлено ${batch.length}`)
      } else {
        const err = r.error || 'ошибка'
        remaining = markSinkFailure(remaining, 'webhook', err, now)
        ctx.onEvent('error', `Webhook: ${err}`)
      }
    }
  }

  if (enabledSinks.includes('sheets')) {
    const now = Date.now()
    const pending = remaining.filter((q) => !q.delivered.sheets && isReadyForSink(q, 'sheets', now))
    if (pending.length > 0) {
      const batch = pending.map((p) => p.lead)
      const range = settings.sheetsRange || 'Sheet1!A:A'
      const r = await flushSheetsSink(batch, settings.spreadsheetId, range)
      if (r.ok) {
        markDelivered('sheets', new Set(pending.map((p) => p.id)))
        ctx.onEvent('info', `Sheets: добавлено ${batch.length} строк`)
      } else {
        const err = r.error || 'ошибка'
        remaining = markSinkFailure(remaining, 'sheets', err, now)
        ctx.onEvent('error', `Sheets: ${err}`)
      }
    }
  }

  remaining = await moveExhaustedToDeadLetters(remaining, enabledSinks, ctx.onEvent)

  return remaining.filter((q) => {
    for (const s of enabledSinks) {
      if (!q.delivered[s]) return true
    }
    return false
  })
}

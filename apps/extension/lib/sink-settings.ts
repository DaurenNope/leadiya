export type SinkSettings = {
  /** Default true — existing behavior. */
  sinkApiEnabled: boolean
  /** Sent as X-Leadiya-Service-Key when set (matches API agent key). */
  apiServiceKey: string
  sinkWebhookEnabled: boolean
  webhookUrl: string
  /** Optional HMAC-SHA256 hex secret for X-Leadiya-Signature header. */
  webhookSecret: string
  sinkSheetsEnabled: boolean
  /** Google spreadsheet ID (from URL). */
  spreadsheetId: string
  /** A1 range start for append, e.g. Sheet1!A:A */
  sheetsRange: string
}

const DEFAULTS: SinkSettings = {
  sinkApiEnabled: true,
  apiServiceKey: '',
  sinkWebhookEnabled: false,
  webhookUrl: '',
  webhookSecret: '',
  sinkSheetsEnabled: false,
  spreadsheetId: '',
  sheetsRange: 'Sheet1!A1',
}

export async function loadSinkSettings(): Promise<SinkSettings> {
  const r = await chrome.storage.local.get([
    'sinkApiEnabled',
    'apiServiceKey',
    'sinkWebhookEnabled',
    'webhookUrl',
    'webhookSecret',
    'sinkSheetsEnabled',
    'spreadsheetId',
    'sheetsRange',
  ])
  return {
    sinkApiEnabled: r.sinkApiEnabled !== false,
    apiServiceKey: typeof r.apiServiceKey === 'string' ? r.apiServiceKey : '',
    sinkWebhookEnabled: Boolean(r.sinkWebhookEnabled),
    webhookUrl: typeof r.webhookUrl === 'string' ? r.webhookUrl.trim() : '',
    webhookSecret: typeof r.webhookSecret === 'string' ? r.webhookSecret : '',
    sinkSheetsEnabled: Boolean(r.sinkSheetsEnabled),
    spreadsheetId: typeof r.spreadsheetId === 'string' ? r.spreadsheetId.trim() : '',
    sheetsRange: typeof r.sheetsRange === 'string' && r.sheetsRange.trim() ? r.sheetsRange.trim() : DEFAULTS.sheetsRange,
  }
}

export function normalizeSpreadsheetId(input: string): string {
  const s = input.trim()
  if (!s) return ''
  try {
    if (s.includes('docs.google.com')) {
      const u = new URL(s)
      const parts = u.pathname.split('/')
      const d = parts.indexOf('d')
      if (d >= 0 && parts[d + 1]) return parts[d + 1].split('/')[0] || ''
    }
  } catch {
    // fall through
  }
  return s
}

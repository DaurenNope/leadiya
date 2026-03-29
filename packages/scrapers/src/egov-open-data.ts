/**
 * data.egov.kz — open data API v4 (Elasticsearch-style JSON in `source` query param).
 * Docs: https://data.egov.kz/pages/samples
 *
 * No API key for public datasets. Dataset slug and version must match the portal
 * (see /meta/{dataset}/{version} on the site). Defaults are overridable via env.
 */

const EGOV_BASE = 'https://data.egov.kz'
const TIMEOUT_MS = 60_000

const DEFAULT_DATASET = process.env.EGOV_LEGAL_ENTITIES_DATASET?.trim() || 'legal_entities'
const DEFAULT_VERSION = process.env.EGOV_LEGAL_ENTITIES_VERSION?.trim() || 'v1'

export class EgovApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly bodySnippet?: string
  ) {
    super(message)
    this.name = 'EgovApiError'
  }
}

function datasetPath(dataset: string, version: string | undefined): string {
  const d = encodeURIComponent(dataset)
  if (version) return `/api/v4/${d}/${encodeURIComponent(version)}`
  return `/api/v4/${d}`
}

export function buildEgovV4Url(
  dataset: string,
  version: string | undefined,
  source: Record<string, unknown>
): string {
  const path = datasetPath(dataset, version)
  const q = encodeURIComponent(JSON.stringify(source))
  return `${EGOV_BASE}${path}?source=${q}`
}

function assertJsonArray(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) {
    const t = data === null ? 'null' : typeof data
    throw new EgovApiError(`Expected JSON array from eGov API, got ${t}`)
  }
  return data as Record<string, unknown>[]
}

/**
 * One page of legal entities (or another dataset if you pass overrides).
 * Uses match_all + from/size pagination.
 */
export async function fetchEgovLegalEntitiesPage(options: {
  from?: number
  size?: number
  dataset?: string
  version?: string
}): Promise<Record<string, unknown>[]> {
  const from = options.from ?? 0
  const size = options.size ?? 500
  const dataset = options.dataset ?? DEFAULT_DATASET
  const version = options.version ?? DEFAULT_VERSION

  const url = buildEgovV4Url(dataset, version, {
    query: { match_all: {} },
    from,
    size,
  })

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'leadiya-egov-client/1.0 (+https://github.com)',
      },
    })
    clearTimeout(timer)

    const text = await res.text()
    const trimmed = text.trimStart()
    if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) {
      throw new EgovApiError(
        'eGov returned HTML instead of JSON (wrong dataset path, blocking, or portal error). Check EGOV_LEGAL_ENTITIES_DATASET / VERSION on data.egov.kz.',
        res.status,
        text.slice(0, 200)
      )
    }

    if (!res.ok) {
      throw new EgovApiError(`eGov HTTP ${res.status}`, res.status, text.slice(0, 300))
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new EgovApiError('eGov response is not valid JSON', res.status, text.slice(0, 200))
    }

    return assertJsonArray(parsed)
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof EgovApiError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('abort')) throw new EgovApiError('eGov request timed out')
    throw new EgovApiError(msg)
  }
}

export async function* iterateEgovLegalEntities(options?: {
  pageSize?: number
  maxRecords?: number
  dataset?: string
  version?: string
}): AsyncGenerator<Record<string, unknown>, void, undefined> {
  const pageSize = options?.pageSize ?? 500
  let from = 0
  let total = 0
  const max = options?.maxRecords ?? Infinity

  while (total < max) {
    const take = Math.min(pageSize, max - total)
    const rows = await fetchEgovLegalEntitiesPage({
      from,
      size: take,
      dataset: options?.dataset,
      version: options?.version,
    })
    if (rows.length === 0) break
    for (const row of rows) {
      yield row
      total++
      if (total >= max) return
    }
    if (rows.length < take) break
    from += rows.length
  }
}

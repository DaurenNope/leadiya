import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TwogisListStrategy } from './twogis-list-collector.js'

const CHECKPOINT_VERSION = 2

export interface TwogisSliceCheckpoint {
  version: number
  city: string
  category: string
  listStrategy: TwogisListStrategy
  searchUrl: string
  /** Current page number (1-based). */
  page: number
  /** Index of the *next* firm to process on the current page (0-based). */
  firmIndexOnPage: number
  /** Running totals for logging. */
  totalProcessed: number
  totalSkipped: number
  updatedAt: string

  // --- V1 compat (ignored on load, never written) ---
  /** @deprecated V1 field — ignored by V2 loader. */
  firmUrls?: string[]
  /** @deprecated V1 field — ignored by V2 loader. */
  nextIndex?: number
}

export function defaultCheckpointDirectory(): string {
  return process.env.TWOGIS_CHECKPOINT_DIR?.trim() || join(process.cwd(), '.twogis-checkpoints')
}

export function checkpointFilePath(directory: string, city: string, category: string, listStrategy: TwogisListStrategy, searchUrl: string): string {
  const h = createHash('sha256')
  h.update(`${city}\n${category}\n${listStrategy}\n${searchUrl}`)
  const name = h.digest('hex') + '.json'
  return join(directory, name)
}

function ensureDir(directory: string) {
  mkdirSync(directory, { recursive: true })
}

export function loadCheckpoint(path: string): TwogisSliceCheckpoint | null {
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf8')
    const data = JSON.parse(raw) as TwogisSliceCheckpoint
    if (data.version !== CHECKPOINT_VERSION || typeof data.page !== 'number') {
      return null
    }
    return data
  } catch {
    return null
  }
}

export function saveCheckpoint(path: string, cp: TwogisSliceCheckpoint) {
  ensureDir(dirname(path))
  writeFileSync(path, JSON.stringify({ ...cp, updatedAt: new Date().toISOString() }, null, 0), 'utf8')
}

export function clearCheckpoint(path: string) {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    /* ignore */
  }
}

export function buildCheckpoint(
  city: string,
  category: string,
  listStrategy: TwogisListStrategy,
  searchUrl: string,
  page: number,
  firmIndexOnPage: number,
  totalProcessed: number,
  totalSkipped: number,
): TwogisSliceCheckpoint {
  return {
    version: CHECKPOINT_VERSION,
    city,
    category,
    listStrategy,
    searchUrl,
    page,
    firmIndexOnPage,
    totalProcessed,
    totalSkipped,
    updatedAt: new Date().toISOString(),
  }
}

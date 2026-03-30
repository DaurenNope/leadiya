#!/usr/bin/env -S node --import tsx
/**
 * Batch cold outreach via WhatsApp.
 *
 * Picks un-contacted leads with phone numbers, renders the cold_outreach
 * template for each, and queues WhatsApp sends via the Leadiya API.
 *
 * Usage:
 *   npx tsx scripts/run-outreach.ts                # dry run, 5 leads
 *   npx tsx scripts/run-outreach.ts --limit 10     # dry run, 10 leads
 *   npx tsx scripts/run-outreach.ts --send          # live: queue sends
 *   npx tsx scripts/run-outreach.ts --send --limit 20
 *   npx tsx scripts/run-outreach.ts --send --delay 2000  # 2s between API calls
 *
 * Env (loaded from repo-root .env):
 *   LEADIYA_API_ORIGIN or LEADIYA_API_BASE_URL
 *   LEADIYA_AGENT_SERVICE_KEY  (if AUTH_BYPASS is off)
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── Load .env ────────────────────────────────────────────────
const envPath = join(repoRoot, '.env')
const envKeys = [
  'LEADIYA_AGENT_SERVICE_KEY',
  'LEADIYA_API_ORIGIN',
  'LEADIYA_API_BASE_URL',
  'AUTH_BYPASS',
]

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1)
    if (k && v && envKeys.includes(k) && !process.env[k]?.trim()) process.env[k] = v
  }
}

// ── CLI args ─────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const param = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}

const LIMIT = parseInt(param('limit', '5'), 10)
const LIVE = flag('send')
const DELAY_MS = parseInt(param('delay', '500'), 10)
const SEQUENCE = param('sequence', 'cold_outreach')
const STEP = parseInt(param('step', '0'), 10)
const CATEGORY = param('category', '')
const CITY = param('city', '')

const base = (
  process.env.LEADIYA_API_BASE_URL ||
  process.env.LEADIYA_API_ORIGIN ||
  'http://localhost:3041'
).replace(/\/$/, '')

const key = process.env.LEADIYA_AGENT_SERVICE_KEY?.trim()
const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (key) headers['X-Leadiya-Service-Key'] = key

// ── Fetch un-contacted leads ─────────────────────────────────
async function fetchCandidates(limit: number): Promise<Array<{
  id: string
  name: string
  city: string | null
  category: string | null
  whatsapp: string | null
}>> {
  const qs = new URLSearchParams({ limit: String(limit + 20), sortBy: 'createdAt', sortOrder: 'desc' })
  if (CATEGORY) qs.set('category', CATEGORY)
  if (CITY) qs.set('city', CITY)

  const res = await fetch(`${base}/api/companies?${qs}`, { headers })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`GET /api/companies ${res.status}: ${txt.slice(0, 300)}`)
  }
  const data = (await res.json()) as { items: Array<Record<string, unknown>> }
  return (data.items || []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    name: (c.name as string) || '(no name)',
    city: (c.city as string) || null,
    category: (c.category as string) || null,
    whatsapp: (c.whatsapp as string) || null,
  }))
}

async function fetchOutreachLog(leadId: string): Promise<boolean> {
  const res = await fetch(`${base}/api/outreach/log?leadId=${leadId}&limit=1`, { headers })
  if (!res.ok) return false
  const data = (await res.json()) as { items: unknown[] }
  return (data.items?.length ?? 0) > 0
}

async function previewMessage(leadId: string): Promise<{
  body: string
  phoneDigits: string | null
  channel: string
} | null> {
  const res = await fetch(`${base}/api/outreach/preview`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ leadId, sequenceKey: SEQUENCE, stepIndex: STEP }),
  })
  if (!res.ok) {
    const txt = await res.text()
    console.error(`  ⚠ Preview failed: ${res.status} ${txt.slice(0, 200)}`)
    return null
  }
  return (await res.json()) as { body: string; phoneDigits: string | null; channel: string }
}

async function queueSend(leadId: string): Promise<{ queued: boolean; jobId: string } | null> {
  const res = await fetch(`${base}/api/outreach/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ leadId, sequenceKey: SEQUENCE, stepIndex: STEP }),
  })
  if (!res.ok) {
    const txt = await res.text()
    console.error(`  ✗ Send failed: ${res.status} ${txt.slice(0, 300)}`)
    return null
  }
  return (await res.json()) as { queued: boolean; jobId: string }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log(`\n🚀 Outreach Run`)
  console.log(`   API:      ${base}`)
  console.log(`   Mode:     ${LIVE ? '🔴 LIVE (sends queued)' : '🟡 DRY RUN (preview only)'}`)
  console.log(`   Sequence: ${SEQUENCE} step ${STEP}`)
  console.log(`   Limit:    ${LIMIT} leads`)
  if (CATEGORY) console.log(`   Category: ${CATEGORY}`)
  if (CITY) console.log(`   City:     ${CITY}`)
  console.log()

  // health check
  const health = await fetch(`${base}/health`).catch(() => null)
  if (!health?.ok) {
    console.error('✗ API not reachable. Start it: cd apps/api && npm run dev')
    process.exit(1)
  }

  // WA status
  const waRes = await fetch(`${base}/api/outreach/whatsapp/status`, { headers }).catch(() => null)
  const waData = waRes?.ok ? (await waRes.json()) as Record<string, unknown> : null
  console.log(`   WA status: ${waData?.status ?? 'unknown'}  baileys: ${waData?.baileysSendEnabled ?? '?'}`)
  if (LIVE && waData?.status !== 'open') {
    console.warn('⚠ WhatsApp not connected — messages will queue but not deliver until reconnected.')
  }
  console.log()

  const allLeads = await fetchCandidates(LIMIT * 3)
  console.log(`   Fetched ${allLeads.length} leads from API`)

  const candidates: typeof allLeads = []
  for (const lead of allLeads) {
    if (!lead.whatsapp || lead.whatsapp === 'https://www.whatsapp.com/' || lead.whatsapp === 'https://www.whatsapp.com') continue
    const hasLog = await fetchOutreachLog(lead.id)
    if (hasLog) continue
    candidates.push(lead)
    if (candidates.length >= LIMIT) break
  }

  console.log(`   ${candidates.length} un-contacted leads with WhatsApp\n`)
  if (candidates.length === 0) {
    console.log('Nothing to do. Run the 2GIS scraper to get more leads.')
    process.exit(0)
  }

  let queued = 0
  let skipped = 0

  for (let i = 0; i < candidates.length; i++) {
    const lead = candidates[i]
    console.log(`[${i + 1}/${candidates.length}] ${lead.name}  (${lead.city ?? '?'} / ${lead.category ?? '?'})`)
    console.log(`   WA: ${lead.whatsapp}`)

    const preview = await previewMessage(lead.id)
    if (!preview || !preview.phoneDigits) {
      console.log(`   ⏭ Skipped — no phone resolved`)
      skipped++
      continue
    }

    const lines = preview.body.split('\n').map((l) => `   │ ${l}`)
    console.log(lines.join('\n'))

    if (LIVE) {
      const result = await queueSend(lead.id)
      if (result?.queued) {
        console.log(`   ✓ Queued (job ${result.jobId})`)
        queued++
        // Start sequence tracking for follow-ups
        await fetch(`${base}/api/outreach/sequences/start`, {
          method: 'POST', headers,
          body: JSON.stringify({ leadId: lead.id, sequenceKey: SEQUENCE }),
        }).catch(() => {})
      } else {
        skipped++
      }
      if (i < candidates.length - 1) await sleep(DELAY_MS)
    } else {
      console.log(`   [dry run — would queue]`)
    }
    console.log()
  }

  console.log('─'.repeat(50))
  if (LIVE) {
    console.log(`Done. ${queued} queued, ${skipped} skipped.`)
    console.log(`Workers will deliver messages respecting rate limits from business.yml.`)
  } else {
    console.log(`Dry run complete. ${candidates.length} leads previewed, ${skipped} skipped.`)
    console.log(`Run with --send to actually queue WhatsApp messages.`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

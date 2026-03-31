#!/usr/bin/env node
/**
 * End-to-end WhatsApp smoke for the usual two-number setup:
 *
 *   • Number A — the account logged in via Baileys (workers). Sends outbound; this is your “business” WA.
 *   • Number B — a normal phone you use as the “lead”: receives the template, can reply; inbound is handled by workers.
 *
 * Prerequisites:
 *   • API + Redis + workers running; WHATSAPP_BAILEYS_ENABLED=true
 *   • Number A: scan QR once (dashboard “WhatsApp” / worker) until GET /api/outreach/whatsapp/status → connected
 *   • Number B: set as LEADIYA_VERIFY_PHONE_OVERRIDE (E.164, e.g. +77001234567) and a real LEADIYA_VERIFY_LEAD_ID
 *
 * Important: POST /send returns 202 “queued” only — the message is sent when apps/workers processes the BullMQ job.
 * If workers are off, or the job is outside business hours (see WHATSAPP_BUSINESS_HOURS_*), nothing arrives on phone B.
 *
 * Usage:
 *   npm run verify:wa-two-numbers
 *   npm run dev:workers    # in another terminal (not started by npm run dev:web)
 *
 * Env (repo-root .env):
 *   LEADIYA_AGENT_SERVICE_KEY     (required for /api/* as agent)
 *   LEADIYA_API_ORIGIN | LEADIYA_API_BASE_URL
 *   DEFAULT_TENANT_ID             (uuid — same tenant as Baileys session; used when using service key)
 *   LEADIYA_VERIFY_LEAD_ID         (uuid — lead row in DB)
 *   LEADIYA_VERIFY_PHONE_OVERRIDE  (number B, if lead row has no phone)
 *   LEADIYA_VERIFY_SEQUENCE_KEY    (default cold_outreach)
 *   LEADIYA_VERIFY_STEP_INDEX      (default 0)
 *   LEADIYA_VERIFY_SEND=1          (default: run POST /send after preview)
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const p = join(repoRoot, '.env')

const ENV_KEYS = [
  'LEADIYA_AGENT_SERVICE_KEY',
  'LEADIYA_API_ORIGIN',
  'LEADIYA_API_BASE_URL',
  'DEFAULT_TENANT_ID',
  'LEADIYA_VERIFY_LEAD_ID',
  'LEADIYA_VERIFY_PHONE_OVERRIDE',
  'LEADIYA_VERIFY_SEQUENCE_KEY',
  'LEADIYA_VERIFY_STEP_INDEX',
  'LEADIYA_VERIFY_SEND',
  'WHATSAPP_BUSINESS_HOURS_TZ',
  'WHATSAPP_BUSINESS_HOURS_START',
  'WHATSAPP_BUSINESS_HOURS_END',
]

if (existsSync(p)) {
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (k && v && ENV_KEYS.includes(k) && !process.env[k]?.trim()) process.env[k] = v
  }
}

const base = (process.env.LEADIYA_API_BASE_URL || process.env.LEADIYA_API_ORIGIN || 'http://localhost:3041').replace(
  /\/$/,
  '',
)
const key = process.env.LEADIYA_AGENT_SERVICE_KEY?.trim()

const agentHeaders = () => ({ 'X-Leadiya-Service-Key': key, 'Content-Type': 'application/json' })

function hourInTz(date, tz) {
  try {
    const s = date.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false })
    return parseInt(s, 10)
  } catch {
    return date.getHours()
  }
}

function businessHoursDiagnosis() {
  const tz = process.env.WHATSAPP_BUSINESS_HOURS_TZ ?? 'Asia/Almaty'
  const start = Number(process.env.WHATSAPP_BUSINESS_HOURS_START ?? '9')
  const end = Number(process.env.WHATSAPP_BUSINESS_HOURS_END ?? '19')
  const now = new Date()
  const h = hourInTz(now, tz)
  const inside = h >= start && h < end
  return { tz, start, end, h, inside }
}

function maskUuid(u) {
  if (!u || u.length < 12) return u || '(not set)'
  return `${u.slice(0, 8)}…${u.slice(-4)}`
}

async function main() {
  let exitCode = 0

  console.log('══ Two-number WhatsApp check ══')
  console.log('A = Baileys (business sender) · B = lead phone (receives + replies)\n')

  const bh = businessHoursDiagnosis()
  console.log(
    `Worker business-hours gate: ${bh.tz} now ≈ ${bh.h}:00 — window [${bh.start}, ${bh.end}) → ` +
      (bh.inside ? 'SENDS NOW (if worker runs)' : 'JOB WILL BE DELAYED until window opens'),
  )
  if (!bh.inside) {
    console.log(
      '  → For instant local testing set: WHATSAPP_BUSINESS_HOURS_START=0 and WHATSAPP_BUSINESS_HOURS_END=24 (restart workers).',
    )
  }

  const defTid = process.env.DEFAULT_TENANT_ID?.trim()
  console.log(`DEFAULT_TENANT_ID (for agent/service sends): ${maskUuid(defTid)}`)

  const h = await fetch(`${base}/health`)
  console.log('\nGET /health', h.status, h.ok ? 'ok' : '')
  if (!h.ok) process.exit(1)

  if (!key) {
    console.error('\nSet LEADIYA_AGENT_SERVICE_KEY in .env (same as API).')
    process.exit(1)
  }

  const wa = await fetch(`${base}/api/outreach/whatsapp/status`, { headers: { 'X-Leadiya-Service-Key': key } })
  const waText = await wa.text()
  let waJson = {}
  try {
    waJson = JSON.parse(waText)
  } catch {
    /* ignore */
  }
  console.log('\nGET /api/outreach/whatsapp/status', wa.status)
  console.log(JSON.stringify(waJson, null, 2))
  if (waJson.status !== 'connected') {
    console.warn('\n⚠ Number A is not "connected". Scan QR in the dashboard WhatsApp view (or worker) until status is connected.')
    exitCode = 1
  }

  const business = await fetch(`${base}/api/outreach/business`, { headers: agentHeaders() })
  const bizText = await business.text()
  let bizJson = {}
  try {
    bizJson = JSON.parse(bizText)
  } catch {
    /* ignore */
  }
  console.log('\nGET /api/outreach/business', business.status)
  console.log('whatsapp_baileys_send=', bizJson.whatsapp_baileys_send, 'whatsapp_inbound_log=', bizJson.whatsapp_inbound_log)

  const leadId = process.env.LEADIYA_VERIFY_LEAD_ID?.trim()
  const sequenceKey = process.env.LEADIYA_VERIFY_SEQUENCE_KEY?.trim() || 'cold_outreach'
  const stepIndex = parseInt(process.env.LEADIYA_VERIFY_STEP_INDEX || '0', 10)
  const phoneOverride = process.env.LEADIYA_VERIFY_PHONE_OVERRIDE?.trim()
  const doSend = process.env.LEADIYA_VERIFY_SEND !== '0' && process.env.LEADIYA_VERIFY_SEND !== 'false'

  if (phoneOverride) {
    console.log('\nNumber B (override):', phoneOverride.slice(0, 4) + '…' + phoneOverride.slice(-3))
  }

  if (!leadId) {
    console.log('\nSet LEADIYA_VERIFY_LEAD_ID (+ optional LEADIYA_VERIFY_PHONE_OVERRIDE for number B) to run preview/send.')
    printFooter()
    process.exit(exitCode)
  }

  const previewBody = { leadId, sequenceKey, stepIndex, ...(phoneOverride ? { phoneOverride } : {}) }
  const prev = await fetch(`${base}/api/outreach/preview`, {
    method: 'POST',
    headers: agentHeaders(),
    body: JSON.stringify(previewBody),
  })
  const prevText = await prev.text()
  console.log('\nPOST /api/outreach/preview', prev.status, prev.ok ? '' : prevText.slice(0, 200))
  if (!prev.ok) exitCode = 1

  if (doSend) {
    if (!bizJson.whatsapp_baileys_send) {
      console.error('POST /send skipped: whatsapp_baileys_send is false')
      exitCode = 1
    } else {
      const send = await fetch(`${base}/api/outreach/send`, {
        method: 'POST',
        headers: agentHeaders(),
        body: JSON.stringify(previewBody),
      })
      const sendText = await send.text()
      console.log('POST /api/outreach/send', send.status, sendText.slice(0, 400))
      if (!send.ok) exitCode = 1
    }
  }

  printFooter()
  process.exit(exitCode)
}

function printFooter() {
  console.log(`
── Why you might see nothing on phone B ──
• 202 "queued" only adds a Redis job. You must run workers:  npm run dev:workers
  (npm run dev:web does NOT start workers — Baileys runs in apps/workers.)
• Outside business hours (see above), the worker moves the job to delayed — no immediate send.
• Service key has no JWT tenant — API/worker use DEFAULT_TENANT_ID; it must match your Baileys tenant.

── After a real send ──
1. On phone B, open the chat with your business number A.
2. Reply; worker logs should show inbound + sequence-engine.
`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

#!/usr/bin/env node
/**
 * Verifies Leadiya API + agent bridge (Hermes): CRM + optional WhatsApp outreach.
 *
 * Usage:
 *   npm run verify:agent-api
 *
 * Env (repo-root .env loaded automatically for known keys):
 *   LEADIYA_API_BASE_URL | LEADIYA_API_ORIGIN
 *   LEADIYA_AGENT_SERVICE_KEY  (required for /api/* as agent)
 *
 * Optional WhatsApp smoke (set LEADIYA_VERIFY_LEAD_ID to a real lead UUID):
 *   LEADIYA_VERIFY_LEAD_ID=uuid
 *   LEADIYA_VERIFY_PHONE_OVERRIDE=+77001234567   # if lead has no phone
 *   LEADIYA_VERIFY_SEQUENCE_KEY=cold_outreach
 *   LEADIYA_VERIFY_STEP_INDEX=0
 *   LEADIYA_VERIFY_SEND=1   # also POST /api/outreach/send (requires WHATSAPP_BAILEYS_ENABLED + workers)
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
  'LEADIYA_VERIFY_LEAD_ID',
  'LEADIYA_VERIFY_PHONE_OVERRIDE',
  'LEADIYA_VERIFY_SEQUENCE_KEY',
  'LEADIYA_VERIFY_STEP_INDEX',
  'LEADIYA_VERIFY_SEND',
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

async function main() {
  let exitCode = 0

  const h = await fetch(`${base}/health`)
  const healthJson = await h.json().catch(() => ({}))
  console.log(
    'GET /health',
    h.status,
    h.ok ? 'ok' : '',
    healthJson.agentBridgeConfigured != null ? `agentBridge=${healthJson.agentBridgeConfigured}` : '',
  )

  const cap = await fetch(`${base}/api/system/capabilities`, {
    headers: key ? { 'X-Leadiya-Service-Key': key } : {},
  })
  if (cap.ok) {
    const j = await cap.json()
    console.log('GET /api/system/capabilities', JSON.stringify(j, null, 2))
  } else {
    console.log('GET /api/system/capabilities', cap.status, key ? '(check service key)' : '(set LEADIYA_AGENT_SERVICE_KEY)')
  }

  if (!h.ok) process.exit(1)

  if (!key) {
    console.error('\nSet LEADIYA_AGENT_SERVICE_KEY in .env (≥24 chars, same on API) to test /api/* as agent.')
    console.error('Run: npm run setup:agent-bridge')
    process.exit(0)
  }

  const companies = await fetch(`${base}/api/companies?limit=1`, { headers: agentHeaders() })
  const companiesText = await companies.text()
  console.log('GET /api/companies?limit=1', companies.status, companies.ok ? 'ok' : companiesText.slice(0, 200))
  if (!companies.ok) exitCode = 1

  const business = await fetch(`${base}/api/outreach/business`, { headers: agentHeaders() })
  const businessText = await business.text()
  let bizJson = {}
  try {
    bizJson = JSON.parse(businessText)
  } catch {
    /* ignore */
  }
  console.log('GET /api/outreach/business', business.status, businessText.slice(0, 600))
  if (!business.ok) exitCode = 1

  const seq = await fetch(`${base}/api/outreach/sequences`, { headers: agentHeaders() })
  const seqJson = await seq.json().catch(() => ({}))
  console.log(
    'GET /api/outreach/sequences',
    seq.status,
    seq.ok ? `sequences=${Array.isArray(seqJson.sequences) ? seqJson.sequences.length : '?'}` : '',
  )
  if (!seq.ok) exitCode = 1

  const leadId = process.env.LEADIYA_VERIFY_LEAD_ID?.trim()
  const sequenceKey = process.env.LEADIYA_VERIFY_SEQUENCE_KEY?.trim() || 'cold_outreach'
  const stepIndex = parseInt(process.env.LEADIYA_VERIFY_STEP_INDEX || '0', 10)
  const phoneOverride = process.env.LEADIYA_VERIFY_PHONE_OVERRIDE?.trim()
  const doSend = process.env.LEADIYA_VERIFY_SEND === '1' || process.env.LEADIYA_VERIFY_SEND === 'true'

  if (leadId) {
    const previewBody = {
      leadId,
      sequenceKey,
      stepIndex,
      ...(phoneOverride ? { phoneOverride } : {}),
    }
    const prev = await fetch(`${base}/api/outreach/preview`, {
      method: 'POST',
      headers: agentHeaders(),
      body: JSON.stringify(previewBody),
    })
    const prevText = await prev.text()
    try {
      const j = JSON.parse(prevText)
      console.log(
        'POST /api/outreach/preview',
        prev.status,
        prev.ok ? `channel=${j.step?.channel ?? '?'}` : prevText.slice(0, 300),
      )
    } catch {
      console.log('POST /api/outreach/preview', prev.status, prevText.slice(0, 300))
    }
    if (!prev.ok) exitCode = 1

    if (doSend) {
      if (!bizJson.whatsapp_baileys_send) {
        console.warn('LEADIYA_VERIFY_SEND=1 but whatsapp_baileys_send is false — set WHATSAPP_BAILEYS_ENABLED=true and run workers.')
        exitCode = 1
      } else {
        const sendBody = {
          leadId,
          sequenceKey,
          stepIndex,
          ...(phoneOverride ? { phoneOverride } : {}),
        }
        const send = await fetch(`${base}/api/outreach/send`, {
          method: 'POST',
          headers: agentHeaders(),
          body: JSON.stringify(sendBody),
        })
        const sendText = await send.text()
        console.log('POST /api/outreach/send', send.status, sendText.slice(0, 400))
        if (!send.ok) exitCode = 1
      }
    }
  } else {
    console.log('(Skip preview/send — set LEADIYA_VERIFY_LEAD_ID in .env to test Hermes-style outreach.)')
  }

  if (exitCode === 0) {
    console.log('\nAgent bridge OK. Hermes: load hermes/.env + docs/hermes-tools.manifest.json')
  }

  process.exit(exitCode)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

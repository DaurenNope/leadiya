/**
 * End-to-end automation dry-run using your two-number setup:
 *  1) POST /api/outreach/send — cold template to LEADIYA_VERIFY_PHONE_OVERRIDE (phone B)
 *  2) Call the same handleInboundReply() the Baileys worker uses — simulates phone B replying
 *
 * Requires: Redis, Postgres, API running, workers running (worker drains the reply queue).
 * Env: same as verify:wa-two-numbers (LEADIYA_AGENT_SERVICE_KEY, LEADIYA_VERIFY_LEAD_ID, …)
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/simulate-wa-convo.ts
 *   npx tsx --env-file=.env scripts/simulate-wa-convo.ts --message="Да, интересно!"
 *   SKIP_SEND=1 npx tsx --env-file=.env scripts/simulate-wa-convo.ts   # only fake inbound (needs prior outbound)
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadDotenv() {
  const p = join(repoRoot, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (k && v && process.env[k] === undefined) process.env[k] = v
  }
}

loadDotenv()

async function main() {
  const base = (process.env.LEADIYA_API_BASE_URL || process.env.LEADIYA_API_ORIGIN || 'http://127.0.0.1:3041').replace(
    /\/$/,
    '',
  )
  const key = process.env.LEADIYA_AGENT_SERVICE_KEY?.trim()
  const leadId = process.env.LEADIYA_VERIFY_LEAD_ID?.trim()
  const phoneRaw =
    process.env.LEADIYA_VERIFY_PHONE_OVERRIDE?.trim() || process.env.FOUNDER_WHATSAPP?.trim()
  const sequenceKey = process.env.LEADIYA_VERIFY_SEQUENCE_KEY?.trim() || 'cold_outreach'
  const stepIndex = parseInt(process.env.LEADIYA_VERIFY_STEP_INDEX || '0', 10)
  const skipSend = process.env.SKIP_SEND === '1' || process.env.SKIP_SEND === 'true'

  const argvMsg = process.argv.find((a) => a.startsWith('--message='))?.split('=').slice(1).join('=')?.trim()
  /** Default uses keyword “интересно” so classification works without Ollama. */
  const inboundMessage =
    argvMsg ||
    process.env.SIMULATE_INBOUND_MESSAGE?.trim() ||
    'Интересно! Расскажите, пожалуйста, подробнее про услуги.'

  if (!leadId) {
    console.error('Set LEADIYA_VERIFY_LEAD_ID')
    process.exit(1)
  }
  if (!phoneRaw) {
    console.error('Set LEADIYA_VERIFY_PHONE_OVERRIDE (phone B)')
    process.exit(1)
  }
  if (!key) {
    console.error('Set LEADIYA_AGENT_SERVICE_KEY')
    process.exit(1)
  }

  const digits = phoneRaw.replace(/\D/g, '')
  const waPeer = `${digits}@s.whatsapp.net`

  const agentHeaders = { 'X-Leadiya-Service-Key': key, 'Content-Type': 'application/json' }

  console.log('══ Simulate WA conversation (A=business Baileys, B=lead phone) ══\n')

  if (!skipSend) {
    const h = await fetch(`${base}/health`)
    if (!h.ok) {
      console.error(`GET /health failed (${h.status}). Start the API.`)
      process.exit(1)
    }

    const body = { leadId, sequenceKey, stepIndex, phoneOverride: phoneRaw }
    console.log('1) POST /api/outreach/send — queue cold template to phone B…')
    const send = await fetch(`${base}/api/outreach/send`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify(body),
    })
    const sendText = await send.text()
    if (!send.ok) {
      console.error(send.status, sendText.slice(0, 400))
      process.exit(1)
    }
    console.log('   →', sendText.slice(0, 200))
    console.log('   (Wait for worker: message appears on phone B before auto-reply can make sense.)\n')
    await new Promise((r) => setTimeout(r, 2500))
  } else {
    console.log('1) SKIP_SEND=1 — assuming you already have outbound in outreach_log for this lead.\n')
  }

  console.log(`2) Simulated inbound from B → ${waPeer.slice(0, 18)}…`)
  console.log(`   Text: "${inboundMessage.slice(0, 120)}${inboundMessage.length > 120 ? '…' : ''}"\n`)

  const { handleInboundReply } = await import('../apps/workers/src/workers/inbound-reply.js')
  await handleInboundReply(leadId, waPeer, inboundMessage)

  console.log('\n3) Done. If workers are running, check:')
  console.log('   • Worker log: [inbound-reply] Queued …')
  console.log('   • Phone B: second WhatsApp (auto-reply) after queue + rate-limit delay')
  console.log('   • Redis: BullMQ job on whatsapp_outreach\n')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})

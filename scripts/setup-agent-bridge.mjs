#!/usr/bin/env node
/**
 * Ensures LEADIYA_AGENT_SERVICE_KEY is set in repo-root .env (≥24 chars).
 * Idempotent: skips generating a new key if a valid one is already present.
 * Writes gitignored hermes/.env with LEADIYA_API_BASE_URL + the same key for Hermes.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const envPath = join(repoRoot, '.env')
const devPortsPath = join(repoRoot, 'dev-ports.json')

function parseAgentKey(content) {
  const m = content.match(/^\s*LEADIYA_AGENT_SERVICE_KEY=(.+)$/m)
  if (!m) return null
  let v = m[1].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  if (v.length < 24) return null
  return v
}

function defaultApiOrigin() {
  try {
    const envContent = readFileSync(envPath, 'utf8')
    const om = envContent.match(/^\s*LEADIYA_API_ORIGIN=(.+)$/m)
    if (om) {
      let o = om[1].trim().replace(/\/$/, '')
      if ((o.startsWith('"') && o.endsWith('"')) || (o.startsWith("'") && o.endsWith("'"))) o = o.slice(1, -1)
      if (/^https?:\/\//i.test(o)) return o
    }
  } catch {
    /* ignore */
  }
  try {
    const j = JSON.parse(readFileSync(devPortsPath, 'utf8'))
    const p = j.localCliApiPort
    if (typeof p === 'number') return `http://localhost:${p}`
  } catch {
    /* ignore */
  }
  return 'http://localhost:3041'
}

function writeHermesEnv(serviceKey) {
  const base = defaultApiOrigin()
  const hermesDir = join(repoRoot, 'hermes')
  mkdirSync(hermesDir, { recursive: true })
  const out = join(hermesDir, '.env')
  const body = `# Synced from repo-root .env by npm run setup:agent-bridge — do not commit (gitignored)
LEADIYA_API_BASE_URL=${base}
LEADIYA_AGENT_SERVICE_KEY=${serviceKey}
`
  writeFileSync(out, body, 'utf8')
  console.log(`Wrote ${out} for Hermes (same key as API).`)
}

function main() {
  if (!existsSync(envPath)) {
    console.error('No .env found. Copy .env.example to .env and fill DATABASE_URL / REDIS_URL, then run again.')
    process.exit(1)
  }

  let content = readFileSync(envPath, 'utf8')
  let key = parseAgentKey(content)

  if (key) {
    console.log('LEADIYA_AGENT_SERVICE_KEY already set in .env.')
  } else {
    key = randomBytes(32).toString('hex')
    const block = `\n# Agent bridge (Hermes HTTP tools) — added by npm run setup:agent-bridge\nLEADIYA_AGENT_SERVICE_KEY=${key}\n`
    writeFileSync(envPath, content.replace(/\s*$/, '') + block, 'utf8')
    console.log('Wrote LEADIYA_AGENT_SERVICE_KEY to .env (64-char hex).')
    console.log('Restart the API if it is running so it picks up the new env.')
    content = readFileSync(envPath, 'utf8')
    key = parseAgentKey(content)
  }

  if (!key) {
    console.error('Internal error: could not read agent key after write.')
    process.exit(1)
  }

  writeHermesEnv(key)
  console.log('Next: start API, then npm run verify:agent-api')
}

main()

import { spawn } from 'node:child_process'

function now() {
  return new Date().toISOString().slice(11, 19)
}

function log(prefix, msg) {
  // eslint-disable-next-line no-console
  console.log(`[${now()}] ${prefix} ${msg}`)
}

function spawnProc(name, args, opts = {}) {
  const child = spawn(args[0], args.slice(1), {
    stdio: 'inherit',
    shell: false,
    ...opts,
  })
  child.on('spawn', () => log(name, 'started'))
  child.on('exit', (code, signal) => {
    log(name, `exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
  })
  child.on('error', (err) => {
    log(name, `error: ${err instanceof Error ? err.message : String(err)}`)
  })
  return child
}

let shuttingDown = false
const children = new Set()

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  log('dev:web:stable', 'shutting down…')
  for (const c of children) {
    try {
      c.kill('SIGINT')
    } catch {
      // ignore
    }
  }
  setTimeout(() => process.exit(0), 1200).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Keep the dashboard alive; restart API on exit.
const dashboard = spawnProc('dashboard', ['npm', 'run', 'dev:dashboard'])
children.add(dashboard)

function startApi() {
  if (shuttingDown) return null
  const api = spawnProc('api', ['npm', 'run', 'dev:api'])
  children.add(api)
  api.on('exit', () => {
    children.delete(api)
    if (shuttingDown) return
    // Small backoff to avoid tight loops if env/port is broken.
    setTimeout(() => {
      log('api', 'restarting…')
      startApi()
    }, 1500).unref()
  })
  return api
}

startApi()

// If the dashboard exits, exit the supervisor too (user probably stopped it).
dashboard.on('exit', () => shutdown())


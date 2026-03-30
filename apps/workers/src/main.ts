import './whatsapp-bootstrap.js'
import './queues.js'
import './schedules.js'
import './freshness-watchdog.js'
import './scraper-runs-watchdog.js'
import './workers/discovery.worker.js'
import './workers/enrichment.worker.js'
import './workers/enrich-website.worker.js'
import './workers/enrich-stat.worker.js'
import './workers/enrich-uchet.worker.js'
import './workers/enrich-goszakup.worker.js'
import './workers/enrich-twogis.worker.js'
import './workers/sequence-engine.js'
import './workers/email-outreach.worker.js'
import './workers/report-engine.js'
import { disconnectCronRedis } from './lib/cron-lock.js'

console.log('Leadiya workers started')

const cleanup = async () => {
  console.log('Shutting down workers...')
  await disconnectCronRedis()
  process.exit(0)
}

process.on('SIGTERM', cleanup)
process.on('SIGINT', cleanup)

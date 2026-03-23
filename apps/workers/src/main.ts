import './whatsapp-bootstrap.js'
import './queues.js'
import './schedules.js'
import './freshness-watchdog.js'
import './workers/discovery.worker.js'
import './workers/enrichment.worker.js'
import './workers/enrich-website.worker.js'
import './workers/enrich-stat.worker.js'
import './workers/enrich-uchet.worker.js'
import './workers/enrich-goszakup.worker.js'
import './workers/enrich-twogis.worker.js'

console.log('Leadiya workers started')

const cleanup = async () => {
  console.log('Shutting down workers...')
  process.exit(0)
}

process.on('SIGTERM', cleanup)
process.on('SIGINT', cleanup)

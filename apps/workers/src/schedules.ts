import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import cron from 'node-cron'
import { parse as parseYaml } from 'yaml'
import { discoveryQueue } from './queues.js'

const DEFAULT_DISCOVERY_CITIES = ['Алматы', 'Астана', 'Шымкент', 'Караганда']
const DEFAULT_DISCOVERY_CATEGORIES = ['Рестораны', 'Кафе', 'Салоны красоты', 'Автосервисы']

function loadDiscoveryConfig(): { cities: string[]; categories: string[] } {
  try {
    const path = join(process.cwd(), 'config', 'business.yml')
    const raw = readFileSync(path, 'utf8')
    const doc = parseYaml(raw) as { discovery?: { cities?: unknown; categories?: unknown } }
    const d = doc.discovery
    const cities = d?.cities
    const categories = d?.categories
    return {
      cities:
        Array.isArray(cities) && cities.every((c) => typeof c === 'string')
          ? cities
          : [...DEFAULT_DISCOVERY_CITIES],
      categories:
        Array.isArray(categories) && categories.every((c) => typeof c === 'string')
          ? categories
          : [...DEFAULT_DISCOVERY_CATEGORIES],
    }
  } catch {
    return {
      cities: [...DEFAULT_DISCOVERY_CITIES],
      categories: [...DEFAULT_DISCOVERY_CATEGORIES],
    }
  }
}

// Discovery: every 6 hours
cron.schedule('0 */6 * * *', async () => {
  const { cities, categories } = loadDiscoveryConfig()

  for (const city of cities) {
    for (const category of categories) {
      await discoveryQueue.add('scrape', { city, category }, {
        // BullMQ jobId cannot contain ':'.
        jobId: `discovery-${city}-${category}-${Date.now()}`,
        removeOnComplete: 100,
        removeOnFail: 500,
      })
    }
  }
  console.log('Discovery jobs queued')
})

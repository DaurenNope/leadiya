import cron from 'node-cron'
import { discoveryQueue } from './queues.js'

// Discovery: every 6 hours
cron.schedule('0 */6 * * *', async () => {
  const cities = ['Алматы', 'Астана', 'Шымкент', 'Караганда']
  const categories = ['Рестораны', 'Кафе', 'Салоны красоты', 'Автосервисы']

  for (const city of cities) {
    for (const category of categories) {
      await discoveryQueue.add('scrape', { city, category }, {
        jobId: `discovery:${city}:${category}:${Date.now()}`,
        removeOnComplete: 100,
        removeOnFail: 500,
      })
    }
  }
  console.log('Discovery jobs queued')
})

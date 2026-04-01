/**
 * Remove BullMQ whatsapp_outreach delayed jobs (backlog from rate limits / business hours).
 * Optional: reset Redis `wa:rate:*` counters so hour/day caps do not immediately defer again.
 *
 *   npm run clean:wa-delayed
 *   npm run clean:wa-delayed -- --reset-rate-keys
 */
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { env } from '@leadiya/config'
import type { WhatsAppOutreachJobData } from '@leadiya/queue'

async function main() {
  const resetRate = process.argv.includes('--reset-rate-keys')
  const q = new Queue<WhatsAppOutreachJobData>('whatsapp_outreach', {
    connection: { url: env.REDIS_URL },
  })

  const before = await q.getJobCounts('waiting', 'active', 'delayed', 'failed')
  console.log('── before ──', JSON.stringify(before))

  const delayed = await q.getJobs(['delayed'], 0, 999, false)
  let removed = 0
  for (const j of delayed) {
    try {
      await j.remove()
      removed++
    } catch {
      /* race */
    }
  }
  console.log(`── removed ${removed} delayed job(s) ──`)

  let rateDeleted = 0
  if (resetRate) {
    const r = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 8000, lazyConnect: true })
    await r.connect()
    let cursor = '0'
    do {
      const [next, keys] = await r.scan(cursor, 'MATCH', 'wa:rate:*', 'COUNT', 200)
      cursor = next
      if (keys.length) rateDeleted += await r.del(...keys)
    } while (cursor !== '0')
    await r.quit()
    console.log(`── reset Redis wa:rate:* → deleted ${rateDeleted} key(s) ──`)
  }

  const after = await q.getJobCounts('waiting', 'active', 'delayed', 'failed')
  console.log('── after ──', JSON.stringify(after))

  await q.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

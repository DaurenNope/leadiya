import { Worker } from 'bullmq'
import { env } from '@leadiya/config'
import { db, outreachLog } from '@leadiya/db'
import { QueueName } from '@leadiya/queue'
import type { EmailOutreachJobData } from '@leadiya/queue'

function isResendEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim())
}

async function sendViaResend(to: string, subject: string, body: string): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim()
  const from = process.env.RESEND_FROM_EMAIL?.trim() || 'onboarding@resend.dev'
  if (!key) throw new Error('RESEND_API_KEY missing')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text: body }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Resend ${res.status}: ${errText.slice(0, 200)}`)
  }
}

const worker = new Worker<EmailOutreachJobData>(
  QueueName.EMAIL_OUTREACH,
  async (job) => {
    const { leadId, to, subject, body, tenantId } = job.data

    if (!isResendEnabled()) {
      console.warn('[email-worker] Resend not configured, logging as skipped')
      await db.insert(outreachLog).values({
        leadId,
        tenantId,
        channel: 'email',
        direction: 'outbound',
        body: `Тема: ${subject}\n\n${body}`,
        status: 'skipped',
      })
      return
    }

    console.log(`[email-worker] Sending to ${to} for lead ${leadId}`)

    await sendViaResend(to, subject, body)

    await db.insert(outreachLog).values({
      leadId,
      tenantId,
      channel: 'email',
      direction: 'outbound',
      body: `Тема: ${subject}\n\n${body}`,
      status: 'sent',
      sentAt: new Date(),
    })

    console.log(`[email-worker] ✓ Sent to ${to}`)
  },
  {
    connection: { url: env.REDIS_URL },
    concurrency: 2,
    limiter: { max: 5, duration: 60_000 },
  },
)

worker.on('failed', (job, err) => {
  console.error(`[email-worker] Job ${job?.id} failed:`, err.message)
})

console.log('[email-worker] Email outreach worker registered')

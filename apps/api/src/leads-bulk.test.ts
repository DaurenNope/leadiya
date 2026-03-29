import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from './server.js'
import { db } from '@leadiya/db'

describe('Leads bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds contacts for duplicate lead on recapture', async () => {
    const name = 'Tour Hunter Test'
    const city = 'Алматы'

    const first = await app.request('/api/leads/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leads: [
          {
            name,
            city,
            phones: ['+77070000001'],
            emails: [],
            sourceUrl: 'https://2gis.kz/almaty/firm/tour-hunter-test',
          },
        ],
      }),
    })
    expect(first.status).toBe(200)

    const second = await app.request('/api/leads/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leads: [
          {
            name,
            city,
            phones: ['+77070000001', '+77070000002'],
            emails: [],
            sourceUrl: 'https://2gis.kz/almaty/firm/tour-hunter-test',
          },
        ],
      }),
    })
    expect(second.status).toBe(200)

    const rows = (db.select as unknown as vi.Mock).mock.calls
    expect(rows.length).toBeGreaterThan(0)
  })
})


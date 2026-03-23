import { db } from './db.js'
import { tenants, leads, contacts } from './schema.js'
import { sql } from 'drizzle-orm'

async function seed() {
  console.log('Seeding database...')

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: 'Dev Team',
      slug: 'dev',
      active: true,
      icpConfig: {},
    })
    .onConflictDoNothing({ target: tenants.slug })
    .returning({ id: tenants.id })

  if (tenant) {
    console.log(`  Created tenant: ${tenant.id}`)
  } else {
    console.log('  Tenant "dev" already exists, skipping')
  }

  const sampleLeads = [
    {
      name: 'ТОО "Пример Компания"',
      bin: '000000000001',
      city: 'Алматы',
      category: 'IT компании',
      source: '2gis',
      website: 'https://example.kz',
      status: 'pending' as const,
    },
    {
      name: 'ИП Тестов Тест',
      bin: '000000000002',
      city: 'Астана',
      category: 'Рестораны',
      source: '2gis',
      status: 'pending' as const,
    },
  ]

  for (const lead of sampleLeads) {
    const [row] = await db
      .insert(leads)
      .values(lead)
      .onConflictDoNothing({ target: leads.bin })
      .returning({ id: leads.id })

    if (row) {
      console.log(`  Created lead: ${lead.name} (${row.id})`)
      await db.insert(contacts).values({
        leadId: row.id,
        phone: lead.bin === '000000000001' ? '+77001234567' : '+77009876543',
        email: lead.bin === '000000000001' ? 'info@example.kz' : null,
        source: 'seed',
      }).onConflictDoNothing()
    }
  }

  console.log('Seed complete.')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})

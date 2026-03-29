/**
 * Applies packages/db/drizzle/0004_twogis_card_category.sql only (idempotent).
 * Uses DATABASE_DIRECT_URL from repo-root .env — same as drizzle.config.ts.
 *
 *   npx tsx --env-file=.env scripts/apply-migration-0004-twogis-card-category.ts
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const sqlPath = join(repoRoot, 'packages/db/drizzle/0004_twogis_card_category.sql')

async function main() {
  const url = process.env.DATABASE_DIRECT_URL?.trim()
  if (!url) {
    console.error('DATABASE_DIRECT_URL is not set. Add it to .env in the repo root.')
    process.exit(1)
  }

  const sql = readFileSync(sqlPath, 'utf8').trim()
  if (!sql.toLowerCase().includes('twogis_card_category')) {
    console.error('Refusing to run: SQL file does not look like 0004 twogis_card_category migration.')
    process.exit(1)
  }

  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    console.log('Applying:', sqlPath)
    await client.query(sql)
    const { rows } = await client.query<{
      column_name: string
      data_type: string
      is_nullable: string
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'leads'
         AND column_name = 'twogis_card_category'`,
    )
    if (rows.length !== 1) {
      console.error('Verification failed: column twogis_card_category not found after apply.')
      process.exit(1)
    }
    const c = rows[0]!
    console.log('OK — leads.twogis_card_category exists:', {
      data_type: c.data_type,
      is_nullable: c.is_nullable,
    })
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

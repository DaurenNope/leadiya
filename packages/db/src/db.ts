import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'
import { env } from '@leadiya/config'

const isProduction = process.env.NODE_ENV === 'production'
const pool = new Pool({
  connectionString: env.DATABASE_DIRECT_URL,
  ssl: isProduction ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
  max: 10,
  connectionTimeoutMillis: 10000,
})
pool.on('error', (err) => console.error('[db] Unexpected pool error', err))

export const db = drizzle(pool, { schema })

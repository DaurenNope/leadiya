import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'
import { env } from '@leadiya/config'

const pool = new Pool({
  connectionString: env.DATABASE_DIRECT_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  connectionTimeoutMillis: 10000,
})

export const db = drizzle(pool, { schema })

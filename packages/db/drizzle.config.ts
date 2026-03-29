import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '../../.env') });

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_DIRECT_URL as string,
  },
  verbose: true,
  /** Keep pushes non-interactive by default (local/dev). */
  strict: process.env.DRIZZLE_KIT_STRICT === 'true',
});

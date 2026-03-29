import { z } from 'zod';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '../../.env') });
dotenv.config();

const schema = z.object({
  // Required for lead generation
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Supabase (required for auth, optional for local dev with AUTH_BYPASS)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /** HS256 secret from Supabase → Project Settings → API → JWT Secret. Enables local JWT verify (no Auth HTTP call per request → less egress). */
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),

  /** Short cache for GET /api/scrapers/runs to cut repeated DB reads (0 = off). */
  SCRAPER_RUNS_CACHE_MS: z.coerce.number().int().min(0).max(120_000).optional(),

  /** Mark 2GIS API scraper_runs stuck in `running` longer than this as error (workers watchdog). Default 6. */
  SCRAPER_RUN_STALE_AFTER_HOURS: z.coerce.number().int().min(1).max(168).optional(),

  // Auth
  AUTH_BYPASS: z.string().optional(),
  /**
   * Shared secret for agent runtimes (e.g. Nous Hermes) calling `/api/*` without a user JWT.
   * Send header `X-Leadiya-Service-Key: <value>`. Min length when set — generate a long random string.
   */
  LEADIYA_AGENT_SERVICE_KEY: z.string().min(24).optional(),

  // Optional integrations
  APP_ENCRYPTION_KEY: z.string().min(32).optional(),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OLLAMA_URL: z.string().url().optional(),
  SMARTPROXY_USER: z.string().optional(),
  SMARTPROXY_PASS: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY: z.string().optional(),
  R2_SECRET_KEY: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
  RESEND_API_KEY: z.string().optional(),
  /** From: address for Resend (e.g. onboarding@resend.dev or your verified domain). */
  RESEND_FROM_EMAIL: z.string().email().optional(),

  // Scraper tuning
  STAGE2_HTTP_ONLY: z.string().optional(),
  TWOGIS_CHECKPOINT_DIR: z.string().optional(),
  /** When "1", log every Crawlee navigation URL (list/search requests). Detail pages already log in scrapeCompanyDetail. */
  TWOGIS_LOG_NAVIGATION: z.string().optional(),

  /** When true, workers load the Baileys WhatsApp sender; API exposes POST /api/outreach/send */
  WHATSAPP_BAILEYS_ENABLED: z.string().optional(),
  /** Directory for Baileys multi-file auth state (default: apps/workers/data/baileys-auth) */
  WHATSAPP_BAILEYS_AUTH_DIR: z.string().optional(),
  /**
   * When true, Baileys worker appends inbound WhatsApp messages to outreach_log (privacy-sensitive).
   * Lets the dashboard show replies next to outbound; still not a full chat UI.
   */
  WHATSAPP_INBOUND_LOG: z.string().optional(),
});

export const env = schema.parse(process.env);

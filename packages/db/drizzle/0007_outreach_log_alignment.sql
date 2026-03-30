ALTER TABLE "outreach_log" ADD COLUMN IF NOT EXISTS "lead_id" uuid REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE "outreach_log" ADD COLUMN IF NOT EXISTS "wa_peer" text;
ALTER TABLE "outreach_log" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "outreach_log" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "outreach_log" ALTER COLUMN "tenant_id" DROP NOT NULL;
ALTER TABLE "outreach_log" ALTER COLUMN "contact_id" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "lead_sequence_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "lead_id" uuid NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "contacts"("id"),
  "sequence_key" text NOT NULL,
  "current_step" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "intent" text DEFAULT 'unknown' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "last_outreach_at" timestamp,
  "next_step_at" timestamp,
  "last_reply_at" timestamp,
  "referred_to_lead_id" uuid REFERENCES "leads"("id"),
  "message_count" integer DEFAULT 0 NOT NULL,
  "qualification_data" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "lss_lead_id_idx" ON "lead_sequence_state" ("lead_id");
CREATE INDEX IF NOT EXISTS "lss_status_next_step_idx" ON "lead_sequence_state" ("status", "next_step_at");
CREATE UNIQUE INDEX IF NOT EXISTS "lss_lead_sequence_unique" ON "lead_sequence_state" ("lead_id", "sequence_key") WHERE "status" = 'active';

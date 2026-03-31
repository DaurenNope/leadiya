CREATE TABLE IF NOT EXISTS "outreach_sequence_defs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "sequence_key" text NOT NULL,
  "definition" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "outreach_sequence_defs_tenant_sequence_key"
  ON "outreach_sequence_defs" ("tenant_id", "sequence_key");

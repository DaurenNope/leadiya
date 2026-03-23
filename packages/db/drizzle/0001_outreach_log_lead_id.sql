ALTER TABLE "outreach_log" ADD COLUMN IF NOT EXISTS "lead_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "outreach_log" ADD CONSTRAINT "outreach_log_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

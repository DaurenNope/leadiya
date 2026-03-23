CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"bin" text,
	"city" text,
	"address" text,
	"website" text,
	"category" text,
	"source" text,
	"source_url" text,
	"email" text,
	"is_wa_reachable" boolean DEFAULT false,
	"instagram" text,
	"whatsapp" text,
	"telegram" text,
	"facebook" text,
	"vk" text,
	"twitter" text,
	"youtube" text,
	"status" text DEFAULT 'pending',
	"raw_data" jsonb,
	"oked_code" text,
	"oked_name" text,
	"employee_band" text,
	"legal_status" text,
	"icp_score" integer DEFAULT 0,
	"rating_2gis" text,
	"reviews_count_2gis" integer DEFAULT 0,
	"opening_hours" jsonb,
	"lat" text,
	"lng" text,
	"discovery_level" integer DEFAULT 1,
	"enrichment_sources" jsonb DEFAULT '{}'::jsonb,
	"last_enriched_at" timestamp,
	"last_scraped_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "leads_bin_unique" UNIQUE("bin")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"full_name" text,
	"role" text,
	"phone" text,
	"email" text,
	"is_primary" boolean DEFAULT false,
	"source" text,
	"source_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"contact_id" uuid,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"body" text,
	"status" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scraper_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scraper" text NOT NULL,
	"status" text NOT NULL,
	"results_count" text,
	"error" text,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"active" boolean DEFAULT true,
	"icp_config" jsonb DEFAULT '{}'::jsonb,
	"owner_id" uuid,
	"stripe_subscription_id" text,
	"stripe_customer_id" text,
	"exports_used" integer DEFAULT 0,
	"quota_reset_at" timestamp,
	"trial_ends_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"portal" text,
	"lot_number" text,
	"subject" text,
	"budget_kzt" text,
	"status" text DEFAULT 'open',
	"company_role" text,
	"published_at" timestamp,
	"awarded_at" timestamp,
	"category" text,
	"region" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenders_lot_number_unique" UNIQUE("lot_number")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contacts" ADD CONSTRAINT "contacts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_log" ADD CONSTRAINT "outreach_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_log" ADD CONSTRAINT "outreach_log_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenders" ADD CONSTRAINT "tenders_company_id_leads_id_fk" FOREIGN KEY ("company_id") REFERENCES "leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

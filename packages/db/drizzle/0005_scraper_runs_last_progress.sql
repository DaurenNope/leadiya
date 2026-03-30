ALTER TABLE "scraper_runs" ADD COLUMN IF NOT EXISTS "last_progress_at" timestamp with time zone;
UPDATE "scraper_runs" SET "last_progress_at" = "started_at" WHERE "last_progress_at" IS NULL;

ALTER TABLE "scraper_runs" ADD COLUMN "current_slice" text;
ALTER TABLE "scraper_runs" ADD COLUMN "total_slices" integer;
ALTER TABLE "scraper_runs" ADD COLUMN "completed_slices" integer DEFAULT 0 NOT NULL;

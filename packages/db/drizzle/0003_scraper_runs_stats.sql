ALTER TABLE "scraper_runs" ADD COLUMN IF NOT EXISTS "detail_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "scraper_runs" ADD COLUMN IF NOT EXISTS "total_skipped" integer NOT NULL DEFAULT 0;
ALTER TABLE "scraper_runs" ADD COLUMN IF NOT EXISTS "list_pages_completed" integer NOT NULL DEFAULT 0;
ALTER TABLE "scraper_runs" ADD COLUMN IF NOT EXISTS "empty_page_streak_max" integer NOT NULL DEFAULT 0;


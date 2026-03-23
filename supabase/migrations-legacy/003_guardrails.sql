-- ============================================================
-- Migration 003: DB Guardrails
-- Prevents duplicate child rows, adds audit trail, adds stats cache
-- ============================================================

-- 1. Unique constraints on child tables (fixes the duplicate-row-on-upsert bug)
--    These turn the buggy "onConflict: 'id'" into a real idempotent upsert.

ALTER TABLE lead_locations
  ADD CONSTRAINT uq_lead_location UNIQUE (lead_id, city, COALESCE(address, ''));

ALTER TABLE lead_industries
  ADD CONSTRAINT uq_lead_industry UNIQUE (lead_id, LOWER(COALESCE(name, '')), COALESCE(code, ''));

-- 2. Scraper runs audit table (persists across server restarts)
CREATE TABLE IF NOT EXISTS scraper_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scraper     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','done','error','cancelled')),
  params      JSONB DEFAULT '{}',
  leads_found INTEGER DEFAULT 0,
  leads_added INTEGER DEFAULT 0,
  errors      INTEGER DEFAULT 0,
  error_msg   TEXT,
  started_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  finished_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_scraper_runs_started ON scraper_runs(started_at DESC);
CREATE INDEX idx_scraper_runs_scraper ON scraper_runs(scraper);

-- 3. Stats cache table — server writes here periodically, UI reads this
--    Never reads live data for dashboard stats again
CREATE TABLE IF NOT EXISTS stats_cache (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed with empty stats so the row exists
INSERT INTO stats_cache (key, value) VALUES
  ('leads_overview', '{"total":0,"byState":{},"bySource":{}}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 4. RLS for new tables
ALTER TABLE scraper_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stats_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access" ON scraper_runs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated full access" ON stats_cache
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Materialised summary view — used by export, NOT the live joins
--    Avoids pulling contacts+phones+emails+locations per lead for list views
CREATE OR REPLACE VIEW leads_summary AS
SELECT
  l.id,
  l.company_name,
  l.company_bin,
  l.company_status,
  l.pipeline->>'state'    AS state,
  l.pipeline->>'source'   AS source,
  l.signals->>'dataQualityScore' AS quality_score,
  l.created_at,
  l.updated_at,
  -- First location only (no array explosion)
  (SELECT city FROM lead_locations WHERE lead_id = l.id AND is_primary = true LIMIT 1) AS city,
  -- Phone count (number only, no full join)
  (SELECT COUNT(*) FROM lead_contacts lc
   JOIN contact_phones cp ON cp.contact_id = lc.id
   WHERE lc.lead_id = l.id) AS phone_count,
  -- First phone
  (SELECT cp.number FROM lead_contacts lc
   JOIN contact_phones cp ON cp.contact_id = lc.id
   WHERE lc.lead_id = l.id LIMIT 1) AS primary_phone,
  -- First email
  (SELECT ce.address FROM lead_contacts lc
   JOIN contact_emails ce ON ce.contact_id = lc.id
   WHERE lc.lead_id = l.id LIMIT 1) AS primary_email
FROM foundation_leads l;

-- Grant access
GRANT SELECT ON leads_summary TO authenticated;

-- 6. Add index on pipeline state for fast filtering (the most common query)
CREATE INDEX IF NOT EXISTS idx_leads_pipeline_state
  ON foundation_leads ((pipeline->>'state'));

CREATE INDEX IF NOT EXISTS idx_leads_pipeline_source
  ON foundation_leads ((pipeline->>'source'));

-- 7. Comments
COMMENT ON TABLE scraper_runs IS 'Persistent audit log of every scraper execution';
COMMENT ON TABLE stats_cache IS 'Pre-computed stats written server-side on a timer, not on every request';
COMMENT ON VIEW leads_summary IS 'Lightweight list view — use this instead of full join queries for list/export endpoints';

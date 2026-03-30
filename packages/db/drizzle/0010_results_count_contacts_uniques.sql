-- results_count: numeric counter (was text for legacy string increments)
ALTER TABLE scraper_runs
  ALTER COLUMN results_count DROP DEFAULT;

ALTER TABLE scraper_runs
  ALTER COLUMN results_count TYPE integer
  USING (
    CASE
      WHEN results_count IS NULL THEN NULL
      WHEN trim(results_count) = '' THEN 0
      WHEN trim(results_count) ~ '^[0-9]+$' THEN trim(results_count)::integer
      ELSE 0
    END
  );

ALTER TABLE scraper_runs
  ALTER COLUMN results_count SET DEFAULT 0;

-- contacts: allow same phone across tenants; keep uniqueness per (tenant, phone) or (lead, phone) for legacy rows
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_key;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_phone_unique
  ON contacts (tenant_id, phone)
  WHERE tenant_id IS NOT NULL AND phone IS NOT NULL AND length(trim(phone)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_lead_phone_unique
  ON contacts (lead_id, phone)
  WHERE tenant_id IS NULL AND lead_id IS NOT NULL AND phone IS NOT NULL AND length(trim(phone)) > 0;

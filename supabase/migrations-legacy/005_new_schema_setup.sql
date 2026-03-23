-- Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── updated_at trigger (apply to every table) ───────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tenders_updated_at
  BEFORE UPDATE ON tenders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Soft delete views ────────────────────────────────────────────────────────
CREATE VIEW active_companies AS
  SELECT * FROM companies WHERE deleted_at IS NULL;

CREATE VIEW active_contacts AS
  SELECT * FROM contacts WHERE deleted_at IS NULL;

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging_leads ENABLE ROW LEVEL SECURITY;

-- Companies: readable by authenticated users, writable by service_role only
CREATE POLICY companies_read ON companies
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

CREATE POLICY companies_write ON companies
  FOR ALL TO service_role
  USING (true);

-- Contacts: same pattern
CREATE POLICY contacts_read ON contacts
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

CREATE POLICY contacts_write ON contacts
  FOR ALL TO service_role
  USING (true);

-- Outreach: tenant sees only their rows
CREATE POLICY outreach_tenant_isolation ON outreach_log
  FOR ALL TO authenticated
  USING (tenant_id = auth.uid());

-- Staging: service_role only
CREATE POLICY staging_service_only ON staging_leads
  FOR ALL TO service_role
  USING (true);

-- ─── Stale company detection view ─────────────────────────────────────────────
CREATE VIEW stale_companies AS
  SELECT id, bin, last_enriched_at, last_tender_at, last_scraped_at
  FROM companies
  WHERE deleted_at IS NULL AND (
    last_enriched_at < NOW() - INTERVAL '7 days' OR last_enriched_at IS NULL OR
    last_tender_at < NOW() - INTERVAL '2 days' OR last_tender_at IS NULL OR
    last_scraped_at < NOW() - INTERVAL '7 days' OR last_scraped_at IS NULL
  );

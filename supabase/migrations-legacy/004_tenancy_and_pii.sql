-- Migration 004: Multi-Tenancy and PII Encryption Foundation
-- Purpose: Implement tenant isolation and prepare for PII encryption (pgcrypto)

-- 1. Ensure extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- 2. Tenants Table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    settings JSONB DEFAULT '{}'::jsonb,
    icp_config JSONB DEFAULT '{}'::jsonb,
    billing_plan TEXT DEFAULT 'starter',
    trial_ends_at TIMESTAMPTZ
);

-- 3. Add tenant_id to all core tables
-- Note: users table already has tenant_id, we just add the FK
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_tenant') THEN
        ALTER TABLE users ADD CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);
    END IF;
END $$;

ALTER TABLE foundation_leads ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE lead_contacts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE lead_locations ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE lead_industries ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE contact_phones ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE contact_emails ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE scraper_runs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE stats_cache ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- 4. PII Hashing for Deduplication & Indexing
-- Store a hash for lookup, while raw data will be encrypted
ALTER TABLE contact_phones ADD COLUMN IF NOT EXISTS number_hash TEXT;
ALTER TABLE contact_emails ADD COLUMN IF NOT EXISTS address_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_tenant ON foundation_leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON lead_contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_phones_hash ON contact_phones(number_hash);
CREATE INDEX IF NOT EXISTS idx_emails_hash ON contact_emails(address_hash);

-- 5. Seed Default Tenant for existing data
INSERT INTO tenants (name, slug) VALUeS ('Default Tenant', 'default') ON CONFLICT (slug) DO NOTHING;

-- Assign existing data to default tenant
UPDATE foundation_leads SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default') WHERE tenant_id IS NULL;
UPDATE lead_contacts SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default') WHERE tenant_id IS NULL;
UPDATE lead_locations SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default') WHERE tenant_id IS NULL;
UPDATE lead_industries SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default') WHERE tenant_id IS NULL;
UPDATE contact_phones SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default') WHERE tenant_id IS NULL;
UPDATE contact_emails SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default') WHERE tenant_id IS NULL;
UPDATE scraper_runs SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default') WHERE tenant_id IS NULL;
UPDATE stats_cache SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default') WHERE tenant_id IS NULL;
UPDATE users SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default') WHERE tenant_id IS NULL;

-- 6. Updated RLS Policies (Tenant Isolation)
-- Foundation Leads
DROP POLICY IF EXISTS "Authenticated users can do everything" ON foundation_leads;
CREATE POLICY "Tenant Leads Isolation" ON foundation_leads
    FOR ALL TO authenticated USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Lead Locations
DROP POLICY IF EXISTS "Authenticated users can do everything" ON lead_locations;
CREATE POLICY "Tenant Locations Isolation" ON lead_locations
    FOR ALL TO authenticated USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Lead Contacts
DROP POLICY IF EXISTS "Authenticated users can do everything" ON lead_contacts;
CREATE POLICY "Tenant Contacts Isolation" ON lead_contacts
    FOR ALL TO authenticated USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Contact Phones
DROP POLICY IF EXISTS "Authenticated users can do everything" ON contact_phones;
CREATE POLICY "Tenant Phones Isolation" ON contact_phones
    FOR ALL TO authenticated USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Contact Emails
DROP POLICY IF EXISTS "Authenticated users can do everything" ON contact_emails;
CREATE POLICY "Tenant Emails Isolation" ON contact_emails
    FOR ALL TO authenticated USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

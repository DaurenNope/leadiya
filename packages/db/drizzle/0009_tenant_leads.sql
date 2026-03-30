-- Tenant-scoped CRM leads: junction between tenants and the shared company directory (leads table).
CREATE TABLE IF NOT EXISTS tenant_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  crm_status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  tags JSONB DEFAULT '[]',
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, lead_id)
);

CREATE INDEX IF NOT EXISTS tl_tenant_id_idx ON tenant_leads(tenant_id);
CREATE INDEX IF NOT EXISTS tl_tenant_status_idx ON tenant_leads(tenant_id, crm_status);

-- Add tenant_id to lead_sequence_state for multi-tenant outreach tracking.
ALTER TABLE lead_sequence_state ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS lss_tenant_id_idx ON lead_sequence_state(tenant_id);

-- Add tenant_id to contacts for tenant-specific contact ownership.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS contacts_tenant_id_idx ON contacts(tenant_id);

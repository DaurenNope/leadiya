-- Foundation Database Migration
-- Run in Supabase SQL Editor
-- Creates comprehensive B2B lead storage for Kazakhstan

-- Main leads table
CREATE TABLE IF NOT EXISTS foundation_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Company Information
  company_name TEXT NOT NULL,
  company_legal_name TEXT,
  company_bin TEXT UNIQUE,
  company_inn TEXT,
  company_ogrn TEXT,
  company_oked TEXT[],
  company_kato TEXT,
  company_year_founded INTEGER,
  company_employee_count INTEGER,
  company_annual_revenue BIGINT,
  company_revenue_currency TEXT,
  company_status TEXT DEFAULT 'unknown',
  company_registration_date DATE,
  
  -- Signals (JSONB for flexibility)
  signals JSONB DEFAULT '{}',
  
  -- Source data preservation
  source_data JSONB DEFAULT '{}',
  
  -- Enrichment
  enrichment JSONB DEFAULT '{}',
  
  -- CRM Pipeline State
  pipeline JSONB DEFAULT '{}',
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  version INTEGER DEFAULT 1,
  
  -- Export tracking
  exports JSONB DEFAULT '{"timesExported": 0, "customerIds": []}',
  
  -- Constraints
  CONSTRAINT valid_status CHECK (company_status IN ('active', 'inactive', 'liquidated', 'unknown'))
);

-- Locations table (one-to-many)
CREATE TABLE IF NOT EXISTS lead_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES foundation_leads(id) ON DELETE CASCADE,
  type TEXT,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT,
  address TEXT,
  postal_code TEXT,
  latitude FLOAT,
  longitude FLOAT,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contacts table (one-to-many)
CREATE TABLE IF NOT EXISTS lead_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES foundation_leads(id) ON DELETE CASCADE,
  role TEXT,
  seniority TEXT,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  job_title TEXT,
  department TEXT,
  discovered_at TIMESTAMP WITH TIME ZONE,
  last_verified_at TIMESTAMP WITH TIME ZONE,
  sources TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contact phones (one-to-many)
CREATE TABLE IF NOT EXISTS contact_phones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES lead_contacts(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  type TEXT,
  is_primary BOOLEAN DEFAULT false,
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contact emails (one-to-many)
CREATE TABLE IF NOT EXISTS contact_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES lead_contacts(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  type TEXT,
  is_primary BOOLEAN DEFAULT false,
  source TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Industries (many-to-many via lead_id)
CREATE TABLE IF NOT EXISTS lead_industries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES foundation_leads(id) ON DELETE CASCADE,
  code TEXT,
  name TEXT,
  source TEXT,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_leads_bin ON foundation_leads(company_bin);
CREATE INDEX idx_leads_inn ON foundation_leads(company_inn);
CREATE INDEX idx_leads_name ON foundation_leads USING gin(to_tsvector('russian', company_name));
CREATE INDEX idx_leads_status ON foundation_leads(company_status) WHERE company_status = 'active';
CREATE INDEX idx_leads_signals ON foundation_leads USING gin(signals);
CREATE INDEX idx_leads_created ON foundation_leads(created_at);

CREATE INDEX idx_locations_city ON lead_locations(city);
CREATE INDEX idx_locations_country ON lead_locations(country);
CREATE INDEX idx_locations_lead ON lead_locations(lead_id);

CREATE INDEX idx_contacts_lead ON lead_contacts(lead_id);
CREATE INDEX idx_contacts_name ON lead_contacts USING gin(to_tsvector('russian', COALESCE(full_name, first_name || ' ' || last_name)));

CREATE INDEX idx_phones_contact ON contact_phones(contact_id);
CREATE INDEX idx_phones_number ON contact_phones(number);

CREATE INDEX idx_emails_contact ON contact_emails(contact_id);
CREATE INDEX idx_emails_address ON contact_emails(address);

CREATE INDEX idx_industries_lead ON lead_industries(lead_id);
CREATE INDEX idx_industries_code ON lead_industries(code);

-- Row Level Security (RLS) policies
ALTER TABLE foundation_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_industries ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (service role bypasses RLS automatically)
CREATE POLICY "Authenticated users can do everything" ON foundation_leads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
  
CREATE POLICY "Authenticated users can do everything" ON lead_locations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
  
CREATE POLICY "Authenticated users can do everything" ON lead_contacts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
  
CREATE POLICY "Authenticated users can do everything" ON contact_phones
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
  
CREATE POLICY "Authenticated users can do everything" ON contact_emails
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
  
CREATE POLICY "Authenticated users can do everything" ON lead_industries
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_foundation_leads_updated_at
  BEFORE UPDATE ON foundation_leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views for common queries
CREATE OR REPLACE VIEW active_leads_with_contacts AS
SELECT 
  l.*,
  COUNT(DISTINCT c.id) as contact_count,
  COUNT(DISTINCT p.id) as phone_count,
  COUNT(DISTINCT e.id) as email_count
FROM foundation_leads l
LEFT JOIN lead_contacts c ON c.lead_id = l.id
LEFT JOIN contact_phones p ON p.contact_id = c.id
LEFT JOIN contact_emails e ON e.contact_id = c.id
WHERE l.company_status = 'active'
GROUP BY l.id;

CREATE OR REPLACE VIEW leads_by_city AS
SELECT 
  city,
  country,
  COUNT(*) as lead_count,
  COUNT(DISTINCT l.id) as companies_with_contacts
FROM lead_locations loc
JOIN foundation_leads l ON l.id = loc.lead_id
WHERE l.company_status = 'active'
GROUP BY city, country
ORDER BY lead_count DESC;

-- Comments for documentation
COMMENT ON TABLE foundation_leads IS 'Comprehensive B2B lead database for Kazakhstan and CIS';
COMMENT ON COLUMN foundation_leads.company_bin IS 'Kazakhstan Business Identification Number';
COMMENT ON COLUMN foundation_leads.signals IS 'JSONB containing lead scores, intent signals, and business indicators';
COMMENT ON COLUMN foundation_leads.source_data IS 'Raw data from all scraping sources preserved for audit';
COMMENT ON COLUMN foundation_leads.exports IS 'Tracking of data exports for sales compliance';

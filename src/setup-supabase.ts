/**
 * Setup Supabase Schema
 * Run once: npx tsx src/setup-supabase.ts
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_ANON_KEY || ''
);

async function setup() {
    console.log('🔧 Setting up Supabase schema...');

    // Test connection
    const { error: testErr } = await supabase.from('leads').select('id', { count: 'exact', head: true });

    if (testErr && testErr.message.includes('does not exist')) {
        console.log('\n⚠️  The "leads" table does not exist yet.');
        console.log('Please run this SQL in your Supabase SQL Editor (supabase.com/dashboard → SQL Editor):\n');
        console.log(`
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  email TEXT,
  phone TEXT,
  whatsapp_number TEXT,
  company_name TEXT NOT NULL DEFAULT '',
  bin TEXT,
  industry TEXT,
  website TEXT,
  linkedin_url TEXT,
  twitter_handle TEXT,
  telegram_handle TEXT,
  instagram_handle TEXT,
  facebook_url TEXT,
  state TEXT DEFAULT 'discovered',
  source TEXT DEFAULT 'manual',
  source_url TEXT,
  score INTEGER DEFAULT 0,
  contact_attempts INTEGER DEFAULT 0,
  needs_research BOOLEAN DEFAULT false,
  data_completeness TEXT DEFAULT 'minimal',
  job_title TEXT,
  address TEXT,
  signal_summary TEXT,
  pain_point TEXT,
  current_sequence TEXT,
  current_step_id TEXT,
  last_contacted_at TIMESTAMPTZ,
  next_contact_at TIMESTAMPTZ,
  tags TEXT[] DEFAULT '{}',
  notes TEXT[] DEFAULT '{}',
  contacts JSONB DEFAULT '[]',
  conversation_history JSONB DEFAULT '[]',
  social_links JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_state ON leads(state);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company_name);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_bin ON leads(bin);
CREATE INDEX IF NOT EXISTS idx_leads_industry ON leads(industry);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON leads FOR ALL USING (true) WITH CHECK (true);
        `);
        console.log('\nAfter running the SQL, re-run this script to verify.\n');
    } else if (testErr) {
        console.error('❌ Connection error:', testErr.message);
    } else {
        console.log('✅ "leads" table exists and is accessible!');

        // Count existing rows
        const { count } = await supabase.from('leads').select('id', { count: 'exact', head: true });
        console.log(`   📊 Current rows: ${count || 0}`);
    }
}

setup().catch(console.error);

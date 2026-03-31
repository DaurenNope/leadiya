-- Fix contacts phone unique constraint to be composite (tenantId, leadId, phone)
-- This allows different leads (or tenants) to share the same phone number.

-- Drop existing unique constraint on phone column if it exists
DO $$
BEGIN
   IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_phone_key') THEN
      ALTER TABLE contacts DROP CONSTRAINT contacts_phone_key;
   END IF;
END $$;

-- Add new composite unique constraint
ALTER TABLE contacts
ADD CONSTRAINT contact_lead_phone_unique UNIQUE (tenantId, leadId, phone);

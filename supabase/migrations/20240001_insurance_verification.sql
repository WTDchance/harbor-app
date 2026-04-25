-- Harbor Insurance Verification Migration
-- Run this in Supabase: Dashboard → SQL Editor → New query → paste → Run

-- Patient insurance records
CREATE TABLE IF NOT EXISTS insurance_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
  patient_name TEXT NOT NULL,
  patient_dob DATE,
  patient_phone TEXT,
  insurance_company TEXT NOT NULL,
  member_id TEXT NOT NULL,
  group_number TEXT,
  subscriber_name TEXT,
  subscriber_dob DATE,
  relationship_to_subscriber TEXT DEFAULT 'self',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Real-time eligibility check results (Stedi 270/271)
CREATE TABLE IF NOT EXISTS eligibility_checks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  insurance_record_id UUID REFERENCES insurance_records(id) ON DELETE CASCADE,
  practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  is_active BOOLEAN,
  mental_health_covered BOOLEAN,
  copay_amount NUMERIC(10,2),
  deductible_total NUMERIC(10,2),
  deductible_met NUMERIC(10,2),
  raw_response JSONB,
  error_message TEXT,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bulk message send log (for Messages feature)
CREATE TABLE IF NOT EXISTS bulk_message_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
  message_template TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  date_filter DATE,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  sent_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_insurance_records_practice ON insurance_records(practice_id);
CREATE INDEX IF NOT EXISTS idx_eligibility_checks_record ON eligibility_checks(insurance_record_id);
CREATE INDEX IF NOT EXISTS idx_eligibility_checks_practice ON eligibility_checks(practice_id);
CREATE INDEX IF NOT EXISTS idx_bulk_message_logs_practice ON bulk_message_logs(practice_id);

-- Enable RLS
ALTER TABLE insurance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulk_message_logs ENABLE ROW LEVEL SECURITY;

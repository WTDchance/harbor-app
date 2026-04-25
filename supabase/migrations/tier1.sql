-- Harbor Tier 1 migration
-- Crisis detection, intake screening, and practice settings sync
-- Run in Supabase SQL Editor at: https://supabase.com/dashboard/project/[PROJECT_ID]/sql

-- Add new columns to existing tables
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS crisis_detected BOOLEAN DEFAULT false;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS therapist_phone TEXT;

-- Create crisis_alerts table
CREATE TABLE IF NOT EXISTS crisis_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  call_log_id UUID REFERENCES call_logs(id) ON DELETE CASCADE,
  patient_phone TEXT,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  sms_sent BOOLEAN DEFAULT false,
  keywords_found TEXT[]
);

-- Create intake_screenings table
CREATE TABLE IF NOT EXISTS intake_screenings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  call_log_id UUID REFERENCES call_logs(id) ON DELETE CASCADE,
  patient_phone TEXT,
  phq2_score INTEGER,
  gad2_score INTEGER,
  phq2_flag BOOLEAN,
  gad2_flag BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_crisis_alerts_practice ON crisis_alerts(practice_id);
CREATE INDEX IF NOT EXISTS idx_crisis_alerts_created ON crisis_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_screenings_practice ON intake_screenings(practice_id);
CREATE INDEX IF NOT EXISTS idx_intake_screenings_created ON intake_screenings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_crisis ON call_logs(crisis_detected) WHERE crisis_detected = true;

-- Enable RLS on new tables
ALTER TABLE crisis_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_screenings ENABLE ROW LEVEL SECURITY;

-- RLS policies for crisis_alerts
CREATE POLICY "Users can read own practice crisis alerts"
  ON crisis_alerts FOR SELECT
  USING (practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID);

CREATE POLICY "Service role can insert crisis alerts"
  ON crisis_alerts FOR INSERT
  WITH CHECK (true);

-- RLS policies for intake_screenings
CREATE POLICY "Users can read own practice intake screenings"
  ON intake_screenings FOR SELECT
  USING (practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID);

CREATE POLICY "Service role can insert intake screenings"
  ON intake_screenings FOR INSERT
  WITH CHECK (true);

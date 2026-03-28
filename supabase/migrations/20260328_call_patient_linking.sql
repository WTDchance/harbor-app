-- Migration: Link call_logs to patients with structured data extraction
-- Adds patient_id FK, call_type, caller_name, and extracted fields to call_logs
-- Makes vapi_call_id nullable (legacy column from old Vapi architecture)

-- 1. Make vapi_call_id nullable (voice server uses Twilio callSid now, doesn't insert vapi_call_id)
ALTER TABLE call_logs ALTER COLUMN vapi_call_id DROP NOT NULL;
ALTER TABLE call_logs ALTER COLUMN vapi_call_id SET DEFAULT NULL;

-- 2. Add patient linking and structured extraction columns
ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS call_type TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS caller_name TEXT,
  ADD COLUMN IF NOT EXISTS insurance_mentioned TEXT,
  ADD COLUMN IF NOT EXISTS session_type TEXT,           -- 'telehealth' or 'in-person'
  ADD COLUMN IF NOT EXISTS preferred_times TEXT,
  ADD COLUMN IF NOT EXISTS reason_for_calling TEXT;

-- 3. Index for faster patient lookups
CREATE INDEX IF NOT EXISTS idx_call_logs_patient_id ON call_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_call_type ON call_logs(call_type);

-- 4. Add preference for telehealth/in-person to patients table
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS preferred_session_type TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN call_logs.call_type IS 'new_patient, existing_patient, scheduling, cancellation, question, crisis, other';
COMMENT ON COLUMN call_logs.caller_name IS 'Name extracted from call transcript by AI';
COMMENT ON COLUMN call_logs.session_type IS 'telehealth or in-person preference extracted from call';

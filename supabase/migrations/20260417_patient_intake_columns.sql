-- ============================================================
-- Add intake demographic columns to patients table
-- These fields are collected on the intake form and need to be
-- written back to the patient record for a complete profile.
-- ============================================================

-- Demographics
ALTER TABLE patients ADD COLUMN IF NOT EXISTS pronouns TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS referral_source TEXT;

-- Insurance (expanded from single 'insurance' text column)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_provider TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_member_id TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_group_number TEXT;

-- Intake completion tracking
ALTER TABLE patients ADD COLUMN IF NOT EXISTS intake_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMP WITH TIME ZONE;

-- General metadata
ALTER TABLE patients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;

-- Telehealth preference (code writes telehealth_preference but column is preferred_session_type)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS telehealth_preference TEXT;

-- Preferred appointment times (collected during call)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS preferred_times TEXT;

COMMENT ON COLUMN patients.pronouns IS 'Patient preferred pronouns from intake demographics';
COMMENT ON COLUMN patients.address IS 'Full address from intake demographics (street, city, state, zip)';
COMMENT ON COLUMN patients.emergency_contact_name IS 'Emergency contact name from intake form';
COMMENT ON COLUMN patients.emergency_contact_phone IS 'Emergency contact phone from intake form';
COMMENT ON COLUMN patients.referral_source IS 'How the patient heard about the practice';
COMMENT ON COLUMN patients.insurance_provider IS 'Insurance carrier name (e.g. Blue Cross, Aetna)';
COMMENT ON COLUMN patients.insurance_member_id IS 'Insurance member/subscriber ID';
COMMENT ON COLUMN patients.insurance_group_number IS 'Insurance group number';
COMMENT ON COLUMN patients.intake_completed IS 'Whether the patient has submitted their intake forms';
COMMENT ON COLUMN patients.intake_completed_at IS 'Timestamp when intake forms were completed';
COMMENT ON COLUMN patients.updated_at IS 'Last modification timestamp';
COMMENT ON COLUMN patients.telehealth_preference IS 'telehealth or in-person preference from call';
COMMENT ON COLUMN patients.preferred_times IS 'Preferred appointment days/times from call';

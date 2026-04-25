-- Harbor Backend Audit — SQL Migration
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/oubmpjtbbobiuzumagec/sql/new
-- Date: 2026-04-01
--
-- This migration:
--   1. Adds missing columns to call_logs (intake tracking)
--   2. Adds missing columns to appointments (reminders)
--   3. Adds missing columns to intake_forms (email tracking)
--   4. Adds missing columns to intake_tokens (correlation with intake_forms)
--   5. Adds unique constraint on patients(practice_id, phone) to prevent duplicates
--   6. Verifies intake_tokens columns exist

-- ============================================================
-- 1. call_logs — intake tracking columns
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'intake_sent') THEN
    ALTER TABLE call_logs ADD COLUMN intake_sent boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'intake_delivery_preference') THEN
    ALTER TABLE call_logs ADD COLUMN intake_delivery_preference text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_logs' AND column_name = 'intake_email') THEN
    ALTER TABLE call_logs ADD COLUMN intake_email text;
  END IF;
END $$;

-- ============================================================
-- 2. appointments — reminder tracking columns
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'reminder_sent_at') THEN
    ALTER TABLE appointments ADD COLUMN reminder_sent_at timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'reminder_opted_out') THEN
    ALTER TABLE appointments ADD COLUMN reminder_opted_out boolean DEFAULT false;
  END IF;
END $$;

-- ============================================================
-- 3. intake_forms — email delivery tracking
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'intake_forms' AND column_name = 'email_sent') THEN
    ALTER TABLE intake_forms ADD COLUMN email_sent boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'intake_forms' AND column_name = 'email_sent_at') THEN
    ALTER TABLE intake_forms ADD COLUMN email_sent_at timestamptz;
  END IF;
END $$;

-- ============================================================
-- 4. intake_tokens — add intake_form_id for correlation
-- ============================================================
DO $$
BEGIN
  -- Add a foreign key column to link intake_tokens to intake_forms
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'intake_tokens' AND column_name = 'intake_form_id') THEN
    ALTER TABLE intake_tokens ADD COLUMN intake_form_id uuid REFERENCES intake_forms(id);
  END IF;

  -- Verify patient_email exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'intake_tokens' AND column_name = 'patient_email') THEN
    ALTER TABLE intake_tokens ADD COLUMN patient_email text;
  END IF;

  -- Verify patient_name exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'intake_tokens' AND column_name = 'patient_name') THEN
    ALTER TABLE intake_tokens ADD COLUMN patient_name text;
  END IF;

  -- Verify delivery_method exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'intake_tokens' AND column_name = 'delivery_method') THEN
    ALTER TABLE intake_tokens ADD COLUMN delivery_method text;
  END IF;
END $$;

-- ============================================================
-- 5. patients — unique constraint to prevent duplicate patients
-- ============================================================
-- This prevents the race condition where two simultaneous calls for
-- the same new patient both create a patient record.
-- Only applies where phone is not null (some patients may not have phone).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'patients_practice_id_phone_unique'
  ) THEN
    CREATE UNIQUE INDEX patients_practice_id_phone_unique
      ON patients (practice_id, phone)
      WHERE phone IS NOT NULL;
  END IF;
END $$;

-- ============================================================
-- 6. Verification query — run this to confirm all columns exist
-- ============================================================
SELECT 'call_logs' as table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'call_logs' AND column_name IN ('intake_sent', 'intake_delivery_preference', 'intake_email')

UNION ALL

SELECT 'appointments', column_name, data_type
FROM information_schema.columns
WHERE table_name = 'appointments' AND column_name IN ('reminder_sent_at', 'reminder_opted_out')

UNION ALL

SELECT 'intake_forms', column_name, data_type
FROM information_schema.columns
WHERE table_name = 'intake_forms' AND column_name IN ('email_sent', 'email_sent_at')

UNION ALL

SELECT 'intake_tokens', column_name, data_type
FROM information_schema.columns
WHERE table_name = 'intake_tokens' AND column_name IN ('intake_form_id', 'patient_email', 'patient_name', 'delivery_method')

UNION ALL

SELECT 'patients', 'practice_id_phone_unique' as column_name, 'unique_index' as data_type
FROM pg_indexes
WHERE indexname = 'patients_practice_id_phone_unique'

ORDER BY table_name, column_name;

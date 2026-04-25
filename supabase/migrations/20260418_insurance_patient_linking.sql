-- Insurance eligibility pre-check launch prep (2026-04-18)
-- Links insurance_records to patients, adds verification timestamps for batch scheduling,
-- and extends eligibility_checks with the fields the 271 response exposes so the
-- per-patient dashboard can show copay, deductible, session limits, and prior-auth status.

-- ============================================================
-- insurance_records: patient linkage + verification cadence
-- ============================================================
ALTER TABLE insurance_records
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_verification_status TEXT,
  ADD COLUMN IF NOT EXISTS next_verify_due TIMESTAMPTZ;

-- Relax NOT NULL on member_id so intake-created records can exist before we have it.
-- (Ellie collects carrier name first; member_id arrives with the intake form.)
ALTER TABLE insurance_records
  ALTER COLUMN member_id DROP NOT NULL;

-- Indexes for the two hot-path queries:
--   1) "show this patient's insurance"        (practice_id, patient_id)
--   2) "which records need re-verification"   (practice_id, next_verify_due)
CREATE INDEX IF NOT EXISTS idx_insurance_records_practice_patient
  ON insurance_records(practice_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_insurance_records_next_verify_due
  ON insurance_records(practice_id, next_verify_due)
  WHERE next_verify_due IS NOT NULL;

-- ============================================================
-- eligibility_checks: surface the rest of the 271 response
-- ============================================================
ALTER TABLE eligibility_checks
  ADD COLUMN IF NOT EXISTS plan_name TEXT,
  ADD COLUMN IF NOT EXISTS coinsurance_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS session_limit INTEGER,
  ADD COLUMN IF NOT EXISTS sessions_used INTEGER,
  ADD COLUMN IF NOT EXISTS prior_auth_required BOOLEAN,
  ADD COLUMN IF NOT EXISTS coverage_start_date DATE,
  ADD COLUMN IF NOT EXISTS coverage_end_date DATE,
  ADD COLUMN IF NOT EXISTS payer_id TEXT,
  ADD COLUMN IF NOT EXISTS trigger_source TEXT;
-- trigger_source values: 'manual' | 'intake' | 'batch_precheck' | 'api'

-- Fast lookup of a patient's latest check from the dashboard / weekly email.
CREATE INDEX IF NOT EXISTS idx_eligibility_checks_record_checked
  ON eligibility_checks(insurance_record_id, checked_at DESC);

-- ============================================================
-- Backfill: link existing insurance_records to patients where possible,
-- and carry the latest eligibility check's timestamp + status up to the
-- parent record so the new dashboard queries work for historical data too.
-- ============================================================

-- Patient linkage by exact phone match within the same practice.
-- (Name-only matching is too fuzzy; phone is reliable when present.)
UPDATE insurance_records ir
SET patient_id = p.id
FROM patients p
WHERE ir.patient_id IS NULL
  AND ir.practice_id = p.practice_id
  AND ir.patient_phone IS NOT NULL
  AND ir.patient_phone = p.phone;

-- Denormalize latest check timestamp + status onto the parent record.
WITH latest AS (
  SELECT DISTINCT ON (insurance_record_id)
    insurance_record_id, checked_at, status
  FROM eligibility_checks
  WHERE insurance_record_id IS NOT NULL
  ORDER BY insurance_record_id, checked_at DESC
)
UPDATE insurance_records ir
SET last_verified_at = latest.checked_at,
    last_verification_status = latest.status
FROM latest
WHERE ir.id = latest.insurance_record_id
  AND ir.last_verified_at IS NULL;

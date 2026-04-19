-- Billing mode tracking (2026-04-19)
--
-- Adds per-patient billing mode so we can distinguish insurance patients from
-- self-pay and sliding-scale. Also adds a status column to insurance_records so
-- we can archive a patient's insurance info when they switch to self-pay
-- without losing the record (they may switch back later, and we want the
-- audit trail regardless). Finally adds a practice-level default self-pay rate.
--
-- Why this exists: once a patient's insurance has been entered and verified
-- via Stedi, the therapist may decide not to bill insurance (out-of-network,
-- high deductible, patient preference). Today there's no way to flip that
-- switch. Downstream effects of being self-pay: the eligibility-precheck cron
-- skips them (prevents burning Stedi API calls), Ellie knows not to re-ask
-- about insurance on returning calls, and the dashboard shows a Self-Pay badge
-- instead of a carrier name.

-- ============================================================
-- patients: billing_mode + change tracking
-- ============================================================

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'pending'
    CHECK (billing_mode IN ('pending', 'insurance', 'self_pay', 'sliding_scale')),
  ADD COLUMN IF NOT EXISTS billing_mode_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_mode_changed_reason TEXT;

COMMENT ON COLUMN patients.billing_mode IS
  'Payment path for this patient. pending = unknown/not yet captured; insurance = we will bill their carrier (insurance_record should exist and be active); self_pay = paying out of pocket (skip eligibility cron, use practices.self_pay_rate_cents); sliding_scale = self_pay at a patient-specific rate.';
COMMENT ON COLUMN patients.billing_mode_changed_at IS
  'Timestamp of the most recent billing_mode change. Null if never changed from default.';
COMMENT ON COLUMN patients.billing_mode_changed_reason IS
  'Free-text reason for the most recent billing_mode change. Required in the UI when switching from insurance to self_pay, optional otherwise.';

-- Hot path: the eligibility-precheck cron filter
-- ("give me patients on this practice who are in insurance or sliding_scale mode")
CREATE INDEX IF NOT EXISTS idx_patients_practice_billing_mode
  ON patients(practice_id, billing_mode);

-- Backfill: existing patients with an active insurance_record get 'insurance'.
-- Everything else stays at the default 'pending'. This keeps the
-- eligibility-precheck cron's behavior identical to today for existing rows
-- while giving us room to flip them to self_pay individually from the UI.
UPDATE patients p
SET billing_mode = 'insurance'
WHERE billing_mode = 'pending'
  AND EXISTS (
    SELECT 1 FROM insurance_records ir
    WHERE ir.patient_id = p.id
      AND ir.practice_id = p.practice_id
  );

-- ============================================================
-- insurance_records: status (active | archived | declined)
-- ============================================================

ALTER TABLE insurance_records
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'declined'));

COMMENT ON COLUMN insurance_records.status IS
  'Lifecycle state. active = current, will be used for billing + eligibility; archived = kept for audit after patient switched to self_pay; declined = patient reported not to have coverage or we confirmed no MH benefit.';

-- Filter out archived/declined records in most list queries
CREATE INDEX IF NOT EXISTS idx_insurance_records_status
  ON insurance_records(practice_id, status);

-- ============================================================
-- practices: self_pay_rate_cents (default rate for self-pay sessions)
-- ============================================================

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS self_pay_rate_cents INTEGER
    CHECK (self_pay_rate_cents IS NULL OR self_pay_rate_cents >= 0);

COMMENT ON COLUMN practices.self_pay_rate_cents IS
  'Default session rate in cents for self-pay patients. Null means unset (UI shows "not configured"). Per-patient sliding-scale overrides will live on patients in a later migration.';

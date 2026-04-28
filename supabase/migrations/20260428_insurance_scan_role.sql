-- Wave 44 / T6 — patient-portal insurance card scan parity.
--
-- Adds scanned_by_role to ehr_insurance_card_scans so the therapist
-- side can distinguish patient-self-uploaded scans from therapist-
-- captured ones. The column is permissive: existing rows backfill to
-- 'therapist' since pre-W44 the only caller was the therapist app.

ALTER TABLE public.ehr_insurance_card_scans
  ADD COLUMN IF NOT EXISTS scanned_by_role TEXT
    NOT NULL DEFAULT 'therapist'
    CHECK (scanned_by_role IN ('therapist', 'patient'));

COMMENT ON COLUMN public.ehr_insurance_card_scans.scanned_by_role IS
  'Who captured this scan: ''therapist'' (existing W41 path) or '
  '''patient'' (W44 portal path). The therapist UI surfaces a badge '
  'for patient-uploaded rows so the front desk knows to review before '
  'updating the patient row''s insurance_* columns.';

-- Existing rows are pre-W44 therapist captures.
UPDATE public.ehr_insurance_card_scans
   SET scanned_by_role = 'therapist'
 WHERE scanned_by_role IS NULL;

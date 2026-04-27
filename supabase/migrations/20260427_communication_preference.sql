-- Wave 39 — patients.communication_preference for no-show email gating.
-- Wave 38's audit found the no-show follow-up was SMS-only; the brief asks
-- email be added but gated by the patient's preferred channel. Patient
-- intake should ask "how would you like us to reach you?" — until that
-- intake question lands in the form, the default 'both' keeps existing
-- behaviour intact.
--
-- Idempotent — safe to re-run.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS communication_preference TEXT
  CHECK (communication_preference IN ('email','sms','both','none'))
  DEFAULT 'both';

-- Backfill: any pre-existing rows get 'both' so no-op on a fresh table.
UPDATE patients SET communication_preference = 'both'
  WHERE communication_preference IS NULL;

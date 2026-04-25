-- Practice billing identifiers (2026-04-18)
-- NPI is required in every 270/271 eligibility request (and every 837 claim)
-- as the billing provider. Tax ID (EIN or SSN for solo practitioners) is
-- required for 837 claim submission when we eventually add it. Both live
-- on the practice row; therapists edit them from the Practice settings page.

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS npi TEXT,
  ADD COLUMN IF NOT EXISTS tax_id TEXT;

COMMENT ON COLUMN practices.npi IS
  '10-digit NPI of the billing provider. Required for Stedi 270/271 eligibility and 837 claim submission.';
COMMENT ON COLUMN practices.tax_id IS
  'Tax ID (EIN) for the billing provider. Required for 837 claim submission. Optional for 270/271 eligibility.';

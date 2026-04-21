-- SMS consent audit fields on patients.
-- The intake form has had an `sms_consent` checkbox for a while, but the
-- value was never persisted. This migration adds the durable audit trail
-- (timestamp + IP + text-version) needed for HIPAA/TCPA defense.
--
-- The text-version string lets us evolve the consent wording over time
-- without losing the record of what an individual patient saw when they
-- agreed.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS sms_consent_given_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_consent_ip TEXT,
  ADD COLUMN IF NOT EXISTS sms_consent_text_version TEXT;

COMMENT ON COLUMN patients.sms_consent_given_at IS
  'Timestamp when patient checked the SMS/appointment-info consent box on intake. NULL = no consent given. Must be set before sending appointment-content SMS.';
COMMENT ON COLUMN patients.sms_consent_text_version IS
  'Short label identifying WHICH consent-text version the patient saw (e.g., v1-2026-04-20). Lets us evolve wording and still audit what was agreed to.';

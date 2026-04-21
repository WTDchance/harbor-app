-- Calendar HIPAA BAA attestation columns.
--
-- Before Harbor syncs PHI-laden events to a Google Calendar, the practice
-- owner must self-attest that:
--   (a) they are on a paid Google Workspace plan (not free Gmail), and
--   (b) their Workspace admin has accepted Google's BAA in the admin console.
--
-- Without these attestations, sync_enabled stays false and we treat the
-- connection as inactive. Audit columns let us prove who attested and when.
--
-- Idempotent.

ALTER TABLE calendar_connections
  ADD COLUMN IF NOT EXISTS hipaa_baa_attested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hipaa_baa_attested_by UUID,
  ADD COLUMN IF NOT EXISTS hipaa_workspace_attested BOOLEAN DEFAULT false;

COMMENT ON COLUMN calendar_connections.hipaa_baa_attested_at IS
  'When the practice owner attested they have a signed BAA with the calendar provider (e.g., Google Workspace BAA). Required before Harbor will sync PHI-laden events. NULL = no attestation, sync_enabled should remain false.';

-- Harbor ICS calendar feed token.
--
-- Each practice gets one opaque token that seeds a read-only subscription URL:
--   https://harborreceptionist.com/api/calendar/ics/<token>
--
-- The feed carries MINIMIZED PHI (reference ID only, no patient name) so it
-- is safe to pass through non-BAA calendar apps (Apple, Google personal,
-- Outlook personal). Therapists who need full details use the Harbor
-- dashboard directly or the direct Google Calendar integration (which is
-- gated behind Workspace + BAA attestation — see
-- 20260420_calendar_baa_attestation.sql).
--
-- Token is unique + nullable; practices without a token have the feed
-- lazily minted on first access via /api/calendar/ics-token.

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS ics_feed_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS ics_feed_revoked_at TIMESTAMPTZ;

COMMENT ON COLUMN practices.ics_feed_token IS
  'Opaque token for Harbor ICS calendar feed. URL: /api/calendar/ics/<token>. Regenerate to invalidate old subscribers.';

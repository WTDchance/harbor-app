-- Add calendar_event_id to appointments so we can persist the provider's
-- event id (Google Calendar event id or Apple CalDAV url) after pushing.
-- This enables clean cancellation (delete by id) and detection of whether
-- a row has been synced.
--
-- Idempotent: safe to run even if the column already exists from an earlier
-- manual migration. The SMS AI agent has been writing to this column, so in
-- most environments it already exists.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_calendar_event_id
  ON appointments(calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

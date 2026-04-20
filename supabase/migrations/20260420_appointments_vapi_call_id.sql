-- Link appointments back to the Vapi call that booked them (2026-04-20)
--
-- Why: we had a silent bug where voice-booked appointments failed to insert
-- (calendar_event_id column was missing) but Ellie still verbally confirmed
-- the booking, so the transcript analyzer marked call_logs.booking_succeeded=true.
-- That gave the dashboard false-positive "booked" signal.
--
-- Fix: every voice-booked appointment now stores the originating vapi_call_id,
-- and call_logs.booking_succeeded is derived from actual DB presence instead
-- of transcript inference. Tool-call path writes the id; analyzer reads it.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS vapi_call_id TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_vapi_call_id
  ON appointments(vapi_call_id)
  WHERE vapi_call_id IS NOT NULL;

COMMENT ON COLUMN appointments.vapi_call_id IS
  'Vapi call id of the call that created this appointment (source=ai_call only). Used to authoritatively determine call_logs.booking_succeeded independent of transcript wording.';

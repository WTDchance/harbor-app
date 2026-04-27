-- Wave 38 TS2 — Chime SDK telehealth.
-- Replaces the old telehealth_room_slug-only world: telehealth appointments
-- now persist a Chime MeetingId + provider. We keep telehealth_room_slug
-- around for backwards-compat with one-tap "open Jitsi" links until a
-- migration cleans up rows that never moved to Chime.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS video_meeting_id TEXT;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS video_provider TEXT
    CHECK (video_provider IS NULL OR video_provider IN ('chime', 'jitsi_public'));

COMMENT ON COLUMN public.appointments.video_meeting_id IS
  'Provider-specific meeting identifier. For provider=chime this is the Chime SDK MeetingId; for jitsi_public this is the room slug (mirrors telehealth_room_slug).';

COMMENT ON COLUMN public.appointments.video_provider IS
  'NULL = no video meeting yet. chime = AWS Chime SDK Meetings (HIPAA-eligible under AWS BAA). jitsi_public = legacy public Jitsi (NOT for prod PHI).';

CREATE INDEX IF NOT EXISTS idx_appointments_video_meeting
  ON public.appointments (video_meeting_id)
  WHERE video_meeting_id IS NOT NULL;

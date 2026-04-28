-- Wave 47 / T1 — telehealth waiting room.
--
-- Patient lands on /portal/meet/[appointmentId]/waiting 5-15 min
-- before their session. Stamping waiting_room_entered_at lets us
-- compute "patient was waiting Y min before therapist joined" for
-- analytics and surfaces a 'patient is in the waiting room' badge
-- on the therapist's Today screen.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS waiting_room_entered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS therapist_joined_meeting_at TIMESTAMPTZ;

COMMENT ON COLUMN public.appointments.waiting_room_entered_at IS
  'Timestamp the patient first hit the /portal/meet/<id>/waiting page. '
  'NULL = patient never opened the waiting room. Used for the '
  'therapist-side patient-is-here badge and the wait-time analytic.';

COMMENT ON COLUMN public.appointments.therapist_joined_meeting_at IS
  'Timestamp the therapist first opened the meeting page. The waiting '
  'room polls and auto-redirects the patient when this is set.';

CREATE INDEX IF NOT EXISTS idx_appointments_in_waiting_room
  ON public.appointments (practice_id, waiting_room_entered_at DESC)
  WHERE waiting_room_entered_at IS NOT NULL
    AND therapist_joined_meeting_at IS NULL;

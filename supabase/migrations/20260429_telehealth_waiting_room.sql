-- Wave 49 / D2 — Telehealth waiting room.
--
-- Adds a practice-controlled waiting layer over the existing video
-- providers (Chime / Jitsi). The provider integration itself
-- (video_meeting_id / video_provider on appointments) does not
-- change; this table only tracks who is in the waiting room, who
-- the therapist has admitted, and the lifecycle of a single
-- session attempt.
--
-- One row per "session attempt." Re-starts after an end_at create
-- a new row so we can audit replay attempts independently.

CREATE TABLE IF NOT EXISTS public.telehealth_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  appointment_id  UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,

  -- Provider-specific room identifier — currently mirrors
  -- appointments.video_meeting_id when a video provider is set, but
  -- the waiting room can exist before the provider session is
  -- created (we only mint the room when the therapist admits).
  jitsi_room_id   TEXT,

  patient_status  TEXT NOT NULL DEFAULT 'invited'
                    CHECK (patient_status IN ('invited', 'in_waiting', 'in_session', 'left')),
  therapist_status TEXT NOT NULL DEFAULT 'not_arrived'
                    CHECK (therapist_status IN ('not_arrived', 'in_session', 'left')),

  -- Optional message from therapist shown in the patient's waiting room
  -- (e.g. "Running 5 minutes late"). Cleared when the session ends.
  therapist_message TEXT,

  started_at      TIMESTAMPTZ,
  admitted_at     TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telehealth_sessions_appt
  ON public.telehealth_sessions (appointment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telehealth_sessions_practice_active
  ON public.telehealth_sessions (practice_id, created_at DESC)
  WHERE ended_at IS NULL;

CREATE OR REPLACE FUNCTION public.telehealth_sessions_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_telehealth_sessions_updated_at ON public.telehealth_sessions;
CREATE TRIGGER trg_telehealth_sessions_updated_at
  BEFORE UPDATE ON public.telehealth_sessions
  FOR EACH ROW EXECUTE FUNCTION public.telehealth_sessions_touch();

ALTER TABLE public.telehealth_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telehealth_sessions_all ON public.telehealth_sessions;
CREATE POLICY telehealth_sessions_all ON public.telehealth_sessions
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.telehealth_sessions IS
  'W49 D2 — practice-controlled telehealth waiting room layered over '
  'Chime / Jitsi. Patient checks in via portal, therapist admits, both '
  'enter the room. Status fields drive both the patient waiting page '
  'and the therapist control panel.';

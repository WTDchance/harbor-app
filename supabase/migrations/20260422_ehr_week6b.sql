-- Week 6 part 2: credentialing tracker + group therapy.

-- Credentialing — clinician license / CEU / panels tracker.
ALTER TABLE public.therapists
  ADD COLUMN IF NOT EXISTS license_number TEXT,
  ADD COLUMN IF NOT EXISTS license_state TEXT,
  ADD COLUMN IF NOT EXISTS license_type TEXT,           -- LCSW, LPC, LMFT, PsyD, etc.
  ADD COLUMN IF NOT EXISTS license_expires_at DATE,
  ADD COLUMN IF NOT EXISTS npi TEXT,
  ADD COLUMN IF NOT EXISTS ceu_hours_ytd NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ceu_required_yearly NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS ceu_cycle_ends_at DATE,
  ADD COLUMN IF NOT EXISTS insurance_panels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS idx_therapists_license_expiry
  ON public.therapists (practice_id, license_expires_at)
  WHERE license_expires_at IS NOT NULL;

-- Group sessions — multiple patients in one appointment (90853).
CREATE TABLE IF NOT EXISTS public.ehr_group_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id      UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  appointment_id   UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  title            TEXT NOT NULL DEFAULT 'Group session',
  group_type       TEXT,  -- e.g. 'DBT Skills', 'Process group'
  facilitator_id   UUID REFERENCES public.therapists(id) ON DELETE SET NULL,
  scheduled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_group_sessions_practice_scheduled
  ON public.ehr_group_sessions (practice_id, scheduled_at DESC);

ALTER TABLE public.ehr_group_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_group_select ON public.ehr_group_sessions;
CREATE POLICY ehr_group_select ON public.ehr_group_sessions FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Group session participants. One row per patient per group session.
-- Attendance status + per-patient note so the therapist can document
-- individual participation while sharing the session record.
CREATE TABLE IF NOT EXISTS public.ehr_group_participants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_session_id  UUID NOT NULL REFERENCES public.ehr_group_sessions(id) ON DELETE CASCADE,
  practice_id       UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id        UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  attendance        TEXT NOT NULL DEFAULT 'attended'
                      CHECK (attendance IN ('attended','absent','late','left_early')),
  participation_note TEXT,
  note_id           UUID REFERENCES public.ehr_progress_notes(id) ON DELETE SET NULL,
  UNIQUE (group_session_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_ehr_group_participants_patient
  ON public.ehr_group_participants (practice_id, patient_id);

ALTER TABLE public.ehr_group_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_group_participants_select ON public.ehr_group_participants;
CREATE POLICY ehr_group_participants_select ON public.ehr_group_participants FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

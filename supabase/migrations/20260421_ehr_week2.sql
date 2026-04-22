-- Week 2 additions: goal linking on notes, telehealth room slugs on
-- appointments, patient-portal access tokens on patients.

-- Link progress notes back to treatment-plan goals (goal IDs are the
-- client-generated IDs inside ehr_treatment_plans.goals JSONB).
ALTER TABLE public.ehr_progress_notes
  ADD COLUMN IF NOT EXISTS linked_goal_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN public.ehr_progress_notes.linked_goal_ids IS
  'Array of client-side goal IDs (from ehr_treatment_plans.goals[].id) that '
  'this note advanced/addressed. Empty array means no explicit linkage.';

-- Telehealth: per-appointment unique room slug so each session has its
-- own link. Generated lazily when the therapist clicks "Start telehealth"
-- or when a reminder-with-telehealth-link is sent.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS telehealth_room_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_telehealth_slug
  ON public.appointments (telehealth_room_slug)
  WHERE telehealth_room_slug IS NOT NULL;

-- Patient portal: a long-random token so patients can log in via magic
-- link (email contains /portal/login?token=...). Expires + can be rotated.
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS portal_access_token TEXT,
  ADD COLUMN IF NOT EXISTS portal_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_last_login_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_portal_token
  ON public.patients (portal_access_token)
  WHERE portal_access_token IS NOT NULL;

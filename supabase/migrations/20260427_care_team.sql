-- Wave 42 / T4 — care team / multi-provider for group practices.
--
-- Today the schema treats one therapist per patient (plus the
-- W38 supervisor relationship which is for cosign only, not
-- clinical care). This adds a flexible M:N join so any patient
-- can have multiple providers each with a distinct role.
--
-- Lifecycle: active TRUE/FALSE + started_at/ended_at gives a
-- historical record of who was on the care team and when. Adding
-- and removing team members is an admin/supervisor action,
-- enforced at the API layer (ADMIN_EMAIL allowlist OR a clinician
-- whose users.id matches another team member's supervisor_user_id).

CREATE TABLE IF NOT EXISTS public.ehr_patient_care_team (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,

  role            TEXT NOT NULL
                    CHECK (role IN (
                      'primary_therapist',
                      'supervising_psychiatrist',
                      'case_manager',
                      'intern',
                      'consulting_provider'
                    )),

  active          BOOLEAN NOT NULL DEFAULT TRUE,
  started_at      DATE NOT NULL DEFAULT CURRENT_DATE,
  ended_at        DATE,

  notes           TEXT,
  added_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A given user can hold the same role on a patient at most once
  -- at a time (toggle active=FALSE + ended_at to retire). A user
  -- CAN hold multiple roles concurrently (e.g. primary therapist
  -- AND case manager during transition periods).
  UNIQUE (patient_id, user_id, role) DEFERRABLE INITIALLY IMMEDIATE
);

COMMENT ON TABLE public.ehr_patient_care_team IS
  'M:N care-team membership. Distinct from users.supervisor_user_id '
  '(W38) which is for cosign only and not clinical care.';

CREATE INDEX IF NOT EXISTS idx_care_team_patient_active
  ON public.ehr_patient_care_team (patient_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_care_team_user_active
  ON public.ehr_patient_care_team (user_id) WHERE active = TRUE;

CREATE OR REPLACE FUNCTION public.care_team_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_care_team_touch ON public.ehr_patient_care_team;
CREATE TRIGGER trg_care_team_touch
  BEFORE UPDATE ON public.ehr_patient_care_team
  FOR EACH ROW EXECUTE FUNCTION public.care_team_touch();

ALTER TABLE public.ehr_patient_care_team ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS care_team_select ON public.ehr_patient_care_team;
CREATE POLICY care_team_select ON public.ehr_patient_care_team
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS care_team_insert ON public.ehr_patient_care_team;
CREATE POLICY care_team_insert ON public.ehr_patient_care_team
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS care_team_update ON public.ehr_patient_care_team;
CREATE POLICY care_team_update ON public.ehr_patient_care_team
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- No DELETE policy — toggle active=FALSE + ended_at instead, so the
-- historical record of 'who was on the care team and when' survives.

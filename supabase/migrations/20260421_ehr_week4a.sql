-- Week 4 first pass: session timer stamps, homework assignments,
-- mandatory reporting log.

-- --- Session timer -------------------------------------------------------
-- Capture actual session start/end on the appointment, so "scheduled
-- 45 min" vs "ran 52 min" is visible and billable.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS actual_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_ended_at   TIMESTAMPTZ;

COMMENT ON COLUMN public.appointments.actual_started_at IS
  'Wall-clock start of the session, set when therapist clicks "Start session".';

-- --- Homework assignments ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ehr_homework (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  note_id         UUID REFERENCES public.ehr_progress_notes(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  due_date        DATE,
  status          TEXT NOT NULL DEFAULT 'assigned'
                    CHECK (status IN ('assigned', 'completed', 'skipped', 'cancelled')),
  completed_at    TIMESTAMPTZ,
  completion_note TEXT, -- patient-entered note when marking complete via portal
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_homework_practice_patient
  ON public.ehr_homework (practice_id, patient_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.ehr_homework_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_homework_touch ON public.ehr_homework;
CREATE TRIGGER trg_ehr_homework_touch
  BEFORE UPDATE ON public.ehr_homework
  FOR EACH ROW EXECUTE FUNCTION public.ehr_homework_touch();

ALTER TABLE public.ehr_homework ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_homework_select ON public.ehr_homework;
CREATE POLICY ehr_homework_select ON public.ehr_homework FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_homework_insert ON public.ehr_homework;
CREATE POLICY ehr_homework_insert ON public.ehr_homework FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_homework_update ON public.ehr_homework;
CREATE POLICY ehr_homework_update ON public.ehr_homework FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- --- Mandatory reporting log ---------------------------------------------
-- Documents what was reported, to whom, and when. Rare events; every
-- therapist needs to be able to reconstruct these exactly if asked.
CREATE TABLE IF NOT EXISTS public.ehr_mandatory_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  report_type     TEXT NOT NULL CHECK (report_type IN (
    'child_abuse', 'elder_abuse', 'dependent_adult_abuse',
    'duty_to_warn', 'duty_to_protect', 'other'
  )),
  reported_to     TEXT NOT NULL, -- agency/person contacted
  reported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  incident_date   DATE,
  summary         TEXT NOT NULL,
  basis_for_report TEXT,
  follow_up       TEXT,
  reference_number TEXT, -- DHS/DCF/etc. case number when available
  status          TEXT NOT NULL DEFAULT 'submitted'
                    CHECK (status IN ('draft', 'submitted', 'closed')),
  reported_by     UUID, -- therapist who made the report
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_mandatory_reports_practice
  ON public.ehr_mandatory_reports (practice_id, created_at DESC);

ALTER TABLE public.ehr_mandatory_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_mand_select ON public.ehr_mandatory_reports;
CREATE POLICY ehr_mand_select ON public.ehr_mandatory_reports FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_mand_insert ON public.ehr_mandatory_reports;
CREATE POLICY ehr_mand_insert ON public.ehr_mandatory_reports FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_mand_update ON public.ehr_mandatory_reports;
CREATE POLICY ehr_mand_update ON public.ehr_mandatory_reports FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

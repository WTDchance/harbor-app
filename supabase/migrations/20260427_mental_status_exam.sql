-- Wave 39 / Task 1 — Mental Status Exam (MSE) typed clinical document.
--
-- Distinct from progress notes and from intake. Therapists complete
-- one at intake and again whenever indicated (significant change,
-- new presenting concerns, mandated review). Some practices include
-- MSE inside their intake document; ours is a separate typed
-- document so it can be re-administered without rewriting the whole
-- intake.
--
-- Multi-row per patient — a fresh exam at each administration.

CREATE TABLE IF NOT EXISTS public.ehr_mental_status_exams (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id          UUID NOT NULL REFERENCES public.practices(id)    ON DELETE CASCADE,
  patient_id           UUID NOT NULL REFERENCES public.patients(id)     ON DELETE CASCADE,
  appointment_id       UUID          REFERENCES public.appointments(id) ON DELETE SET NULL,
  administered_by      UUID NOT NULL REFERENCES public.users(id)        ON DELETE RESTRICT,
  administered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Lifecycle.
  status               TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'completed', 'amended')),
  completed_at         TIMESTAMPTZ,

  -- 11 MSE domains. All free text, all nullable until completion.
  appearance           TEXT,
  behavior             TEXT,
  speech               TEXT,
  mood                 TEXT,        -- subjective: therapist quotes patient
  affect               TEXT,        -- objective: therapist's observation
  thought_process      TEXT,
  thought_content      TEXT,
  perception           TEXT,
  cognition            TEXT,        -- orientation, attention, memory
  insight              TEXT,
  judgment             TEXT,

  summary              TEXT,        -- overall clinical impression

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ehr_mental_status_exams IS
  'Mental Status Exam — typed clinical document, multi-row per patient. '
  'Complete at intake, re-administer on significant change.';

CREATE INDEX IF NOT EXISTS idx_mse_patient
  ON public.ehr_mental_status_exams (patient_id, administered_at DESC);
CREATE INDEX IF NOT EXISTS idx_mse_practice_status
  ON public.ehr_mental_status_exams (practice_id, status);
CREATE INDEX IF NOT EXISTS idx_mse_appointment
  ON public.ehr_mental_status_exams (appointment_id)
  WHERE appointment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mse_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_mse_touch ON public.ehr_mental_status_exams;
CREATE TRIGGER trg_mse_touch
  BEFORE UPDATE ON public.ehr_mental_status_exams
  FOR EACH ROW EXECUTE FUNCTION public.mse_touch();

ALTER TABLE public.ehr_mental_status_exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mse_select ON public.ehr_mental_status_exams;
CREATE POLICY mse_select ON public.ehr_mental_status_exams
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS mse_insert ON public.ehr_mental_status_exams;
CREATE POLICY mse_insert ON public.ehr_mental_status_exams
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS mse_update ON public.ehr_mental_status_exams;
CREATE POLICY mse_update ON public.ehr_mental_status_exams
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

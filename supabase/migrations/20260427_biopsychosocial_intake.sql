-- Wave 38 / TS8 — structured biopsychosocial intake document.
--
-- A typed clinical document distinct from progress notes. Each new
-- patient should have exactly one of these completed during/after the
-- first appointment. Sections mirror the standard outpatient
-- biopsychosocial assessment used in CMS-aligned clinical practice.

CREATE TABLE IF NOT EXISTS public.ehr_biopsychosocial_intakes (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id                   UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id                    UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  therapist_id                  UUID REFERENCES public.therapists(id)         ON DELETE SET NULL,
  appointment_id                UUID REFERENCES public.appointments(id)       ON DELETE SET NULL,

  -- 10 narrative sections, all free text, all nullable until completed.
  presenting_problem            TEXT,
  history_of_present_illness    TEXT,
  psychiatric_history           TEXT,
  medical_history               TEXT,
  family_history                TEXT,
  social_history                TEXT,
  substance_use                 TEXT,
  trauma_history                TEXT,
  current_functioning           TEXT,
  mental_status_exam            TEXT,

  -- Lifecycle.
  status                        TEXT NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft', 'completed', 'amended')),
  completed_at                  TIMESTAMPTZ,
  completed_by                  UUID REFERENCES public.users(id),

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One active intake per patient (allow draft + completed transitions to
  -- coexist briefly via UPDATE, not separate rows).
  UNIQUE (patient_id)
);

COMMENT ON TABLE public.ehr_biopsychosocial_intakes IS
  'Structured biopsychosocial intake. One row per patient — the existing '
  'row is updated through draft -> completed -> amended states rather than '
  'creating duplicates.';

CREATE INDEX IF NOT EXISTS idx_bps_practice
  ON public.ehr_biopsychosocial_intakes (practice_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bps_status
  ON public.ehr_biopsychosocial_intakes (practice_id, status)
  WHERE status = 'draft';

CREATE OR REPLACE FUNCTION public.bps_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_bps_touch ON public.ehr_biopsychosocial_intakes;
CREATE TRIGGER trg_bps_touch
  BEFORE UPDATE ON public.ehr_biopsychosocial_intakes
  FOR EACH ROW EXECUTE FUNCTION public.bps_touch();

ALTER TABLE public.ehr_biopsychosocial_intakes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bps_select ON public.ehr_biopsychosocial_intakes;
CREATE POLICY bps_select ON public.ehr_biopsychosocial_intakes
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS bps_insert ON public.ehr_biopsychosocial_intakes;
CREATE POLICY bps_insert ON public.ehr_biopsychosocial_intakes
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS bps_update ON public.ehr_biopsychosocial_intakes;
CREATE POLICY bps_update ON public.ehr_biopsychosocial_intakes
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

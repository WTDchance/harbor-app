-- Wave 39 / Task 2 — Discharge summary typed clinical document.
--
-- Required for clean records and any future continuity-of-care
-- request. One row per patient — if the patient returns and is
-- re-activated, the row stays as historical context (a future
-- amendment endpoint can mutate it; this PR doesn't include one).

CREATE TABLE IF NOT EXISTS public.ehr_discharge_summaries (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id                   UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id                    UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  discharged_by                 UUID NOT NULL REFERENCES public.users(id)     ON DELETE RESTRICT,
  discharged_at                 DATE NOT NULL DEFAULT CURRENT_DATE,
  discharge_reason              TEXT NOT NULL DEFAULT 'completed'
                                  CHECK (discharge_reason IN (
                                    'completed','mutual_termination',
                                    'therapist_initiated','patient_initiated',
                                    'transferred','no_show_extended','other'
                                  )),

  -- Required narratives at completion (NULL ok in draft).
  services_dates                TEXT,
  presenting_problem            TEXT,
  course_of_treatment           TEXT,
  progress_summary              TEXT,
  recommendations               TEXT,

  -- Optional narratives.
  final_diagnoses               TEXT[],
  medications_at_discharge      TEXT,
  risk_assessment_at_discharge  TEXT,
  referrals                     TEXT,

  status                        TEXT NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft', 'completed')),
  completed_at                  TIMESTAMPTZ,

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One per patient — re-activation keeps the existing row as historical
  -- context. A future endpoint can amend; this PR is draft -> completed only.
  UNIQUE (patient_id)
);

COMMENT ON TABLE public.ehr_discharge_summaries IS
  'Discharge summary — one per patient. draft -> completed. Completion '
  'sets patients.patient_status = ''discharged'' (handled in the API '
  'route, not via trigger, so the audit row captures the actor).';

CREATE INDEX IF NOT EXISTS idx_disc_practice
  ON public.ehr_discharge_summaries (practice_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_disc_status
  ON public.ehr_discharge_summaries (practice_id, status);

CREATE OR REPLACE FUNCTION public.disc_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_disc_touch ON public.ehr_discharge_summaries;
CREATE TRIGGER trg_disc_touch
  BEFORE UPDATE ON public.ehr_discharge_summaries
  FOR EACH ROW EXECUTE FUNCTION public.disc_touch();

ALTER TABLE public.ehr_discharge_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS disc_select ON public.ehr_discharge_summaries;
CREATE POLICY disc_select ON public.ehr_discharge_summaries
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS disc_insert ON public.ehr_discharge_summaries;
CREATE POLICY disc_insert ON public.ehr_discharge_summaries
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS disc_update ON public.ehr_discharge_summaries;
CREATE POLICY disc_update ON public.ehr_discharge_summaries
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

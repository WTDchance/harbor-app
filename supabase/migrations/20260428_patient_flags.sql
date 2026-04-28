-- Wave 47 / T4 — patient flag / sticky note system.
--
-- Non-clinical context the therapist sees at the top of the patient
-- profile to remember in session: "going through divorce", "daughter
-- just had baby", "mother passed away last spring".
--
-- NOT clinical content (those go in progress notes). NOT a chart entry
-- in any structured sense. Color-coded sticky chips that don't belong
-- on a billed claim or in a treatment plan.
--
-- Hard limit of 5 active flags per patient enforced via partial unique
-- index check at the API layer (a hard CHECK can't reference a
-- subquery; the API counts before INSERT and 409s if already at 5).

CREATE TABLE IF NOT EXISTS public.ehr_patient_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,

  content         TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 200),
  color           TEXT NOT NULL DEFAULT 'blue'
                    CHECK (color IN ('blue','green','yellow','red')),

  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_patient_flags_active
  ON public.ehr_patient_flags (practice_id, patient_id, created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_patient_flags_archived
  ON public.ehr_patient_flags (practice_id, patient_id, archived_at DESC)
  WHERE archived_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ehr_patient_flags_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_patient_flags_touch ON public.ehr_patient_flags;
CREATE TRIGGER trg_ehr_patient_flags_touch
  BEFORE UPDATE ON public.ehr_patient_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.ehr_patient_flags_touch();

ALTER TABLE public.ehr_patient_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_flags_all ON public.ehr_patient_flags;
CREATE POLICY patient_flags_all ON public.ehr_patient_flags
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

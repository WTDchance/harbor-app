-- Treatment plans: the clinical-governance backbone. Required for insurance
-- reimbursement. One active plan per patient at a time (enforced by a
-- partial unique index on status='active'); historical plans stay for audit.

CREATE TABLE IF NOT EXISTS public.ehr_treatment_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id      UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  therapist_id     UUID REFERENCES public.therapists(id) ON DELETE SET NULL,

  title            TEXT NOT NULL DEFAULT 'Treatment plan',
  presenting_problem TEXT,
  diagnoses        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], -- ICD-10s

  -- Goals is a structured JSONB array:
  -- [{ id, text, target_date?, objectives: [{ id, text, interventions: string[] }] }]
  goals            JSONB NOT NULL DEFAULT '[]'::JSONB,

  frequency        TEXT,        -- e.g. "Weekly individual therapy, 45 minutes"
  start_date       DATE DEFAULT CURRENT_DATE,
  review_date      DATE,        -- when plan should be reviewed (typically 90 days)

  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('draft', 'active', 'revised', 'completed', 'archived')),
  signed_at        TIMESTAMPTZ,
  signed_by        UUID,
  patient_acknowledged_at TIMESTAMPTZ,

  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_plans_practice_patient
  ON public.ehr_treatment_plans (practice_id, patient_id, created_at DESC);

-- At most one active plan per patient
CREATE UNIQUE INDEX IF NOT EXISTS uq_ehr_plans_active_per_patient
  ON public.ehr_treatment_plans (patient_id)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.ehr_treatment_plans_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_plans_touch ON public.ehr_treatment_plans;
CREATE TRIGGER trg_ehr_plans_touch
  BEFORE UPDATE ON public.ehr_treatment_plans
  FOR EACH ROW EXECUTE FUNCTION public.ehr_treatment_plans_touch_updated_at();

ALTER TABLE public.ehr_treatment_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehr_plans_select ON public.ehr_treatment_plans;
CREATE POLICY ehr_plans_select ON public.ehr_treatment_plans FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_plans_insert ON public.ehr_treatment_plans;
CREATE POLICY ehr_plans_insert ON public.ehr_treatment_plans FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_plans_update ON public.ehr_treatment_plans;
CREATE POLICY ehr_plans_update ON public.ehr_treatment_plans FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_plans_delete ON public.ehr_treatment_plans;
CREATE POLICY ehr_plans_delete ON public.ehr_treatment_plans FOR DELETE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

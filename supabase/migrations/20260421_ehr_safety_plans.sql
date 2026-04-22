-- Safety plans: Stanley-Brown Safety Planning Intervention structure.
-- Used when a patient presents with suicide risk. Core crisis-care tool.
-- One active plan per patient; updates create a new row with status='revised'
-- on the prior active one.

CREATE TABLE IF NOT EXISTS public.ehr_safety_plans (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id               UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  therapist_id             UUID REFERENCES public.therapists(id) ON DELETE SET NULL,

  -- Stanley-Brown six steps
  warning_signs            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  internal_coping          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  distraction_people_places TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  support_contacts         JSONB NOT NULL DEFAULT '[]'::JSONB, -- [{ name, phone, relationship }]
  professional_contacts    JSONB NOT NULL DEFAULT '[]'::JSONB, -- [{ name, phone, role }]
  means_restriction        TEXT,
  reasons_for_living       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  crisis_hotline_acknowledged BOOLEAN NOT NULL DEFAULT true, -- 988 Lifeline

  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('draft', 'active', 'revised', 'archived')),

  created_by               UUID,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_safety_practice_patient
  ON public.ehr_safety_plans (practice_id, patient_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ehr_safety_active_per_patient
  ON public.ehr_safety_plans (patient_id)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.ehr_safety_plans_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_safety_touch ON public.ehr_safety_plans;
CREATE TRIGGER trg_ehr_safety_touch
  BEFORE UPDATE ON public.ehr_safety_plans
  FOR EACH ROW EXECUTE FUNCTION public.ehr_safety_plans_touch();

ALTER TABLE public.ehr_safety_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehr_safety_select ON public.ehr_safety_plans;
CREATE POLICY ehr_safety_select ON public.ehr_safety_plans FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_safety_insert ON public.ehr_safety_plans;
CREATE POLICY ehr_safety_insert ON public.ehr_safety_plans FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_safety_update ON public.ehr_safety_plans;
CREATE POLICY ehr_safety_update ON public.ehr_safety_plans FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

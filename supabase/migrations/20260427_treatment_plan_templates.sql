-- Wave 43 / T3 — treatment plan templates by diagnosis.
--
-- Therapists treating their 30th patient with major depressive
-- disorder shouldn't have to re-author boilerplate goals/objectives
-- for the 30th time. Templates let a practice maintain a small
-- library keyed on ICD-10 code(s); cloning a template into a real
-- treatment plan creates an editable copy on the patient with the
-- diagnosis prefilled.
--
-- Per-practice (not global) — practices vary substantially in their
-- preferred frameworks (CBT vs DBT vs trauma-focused, etc.) and the
-- granularity of objectives.

CREATE TABLE IF NOT EXISTS public.ehr_treatment_plan_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id   UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  name          TEXT NOT NULL,
  description   TEXT,
  -- One template can target multiple ICD-10 codes (e.g. F90.0 + F90.1
  -- for ADHD inattentive vs combined). Empty array = "any diagnosis".
  diagnoses     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  presenting_problem TEXT,
  -- Same shape as ehr_treatment_plans.goals
  goals         JSONB NOT NULL DEFAULT '[]'::JSONB,
  frequency     TEXT,

  -- Soft-archive instead of delete so historical clones can still
  -- reference where the boilerplate came from.
  archived_at   TIMESTAMPTZ,

  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tp_templates_practice_active
  ON public.ehr_treatment_plan_templates (practice_id, archived_at)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tp_templates_diagnoses
  ON public.ehr_treatment_plan_templates USING GIN (diagnoses);

CREATE OR REPLACE FUNCTION public.ehr_tp_templates_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_tp_templates_updated_at ON public.ehr_treatment_plan_templates;
CREATE TRIGGER trg_ehr_tp_templates_updated_at
  BEFORE UPDATE ON public.ehr_treatment_plan_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.ehr_tp_templates_touch_updated_at();

ALTER TABLE public.ehr_treatment_plan_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tp_templates_select ON public.ehr_treatment_plan_templates;
CREATE POLICY tp_templates_select ON public.ehr_treatment_plan_templates
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS tp_templates_insert ON public.ehr_treatment_plan_templates;
CREATE POLICY tp_templates_insert ON public.ehr_treatment_plan_templates
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS tp_templates_update ON public.ehr_treatment_plan_templates;
CREATE POLICY tp_templates_update ON public.ehr_treatment_plan_templates
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS tp_templates_delete ON public.ehr_treatment_plan_templates;
CREATE POLICY tp_templates_delete ON public.ehr_treatment_plan_templates
  FOR DELETE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

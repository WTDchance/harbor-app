-- Wave 46 / T4 — custom assessment builder.
--
-- Practices can author their own scales beyond PHQ-9 / GAD-7 etc.
-- Stored as ehr_custom_assessment_templates with a JSONB question
-- list, a scoring_function picked from a small allow-list (no
-- arbitrary code), and severity bands.
--
-- Administered assessments land in the existing outcome_assessments
-- table with instrument='custom:<template_id>' so the timeline,
-- patient detail, and engagement signal pipelines all work
-- without changes.

CREATE TABLE IF NOT EXISTS public.ehr_custom_assessment_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  description     TEXT,

  -- Question schema:
  -- [{ id, text, type, choices?, score_weight?, reverse_scored?,
  --    subscale? }]
  -- type ∈ ('likert_1_5','likert_0_4','yes_no','numeric','free_text','multiple_choice')
  questions       JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Scoring approach. The application code in
  -- lib/aws/ehr/assessments/score.ts maps each value to a pure
  -- function — this column is essentially an enum, but stored as
  -- TEXT so practices can extend with named variants without a
  -- migration. CHECK keeps things explicit while still letting us
  -- add a new value with a one-line CHECK update.
  scoring_function TEXT NOT NULL DEFAULT 'sum'
                     CHECK (scoring_function IN (
                       'sum',
                       'mean',
                       'weighted_sum',
                       'max_subscale',
                       'phq9_like',
                       'gad7_like'
                     )),

  -- Severity bands:
  -- [{ min, max, label, color, alert_on_threshold? }]
  -- The administering UI uses these to render the score with a
  -- color band; alert_on_threshold=true triggers a Today alert when
  -- a score lands in that band.
  severity_bands  JSONB NOT NULL DEFAULT '[]'::jsonb,

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_assessments_practice_active
  ON public.ehr_custom_assessment_templates (practice_id, is_active)
  WHERE is_active = TRUE;

CREATE OR REPLACE FUNCTION public.ehr_custom_assessments_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_custom_assessments_touch ON public.ehr_custom_assessment_templates;
CREATE TRIGGER trg_ehr_custom_assessments_touch
  BEFORE UPDATE ON public.ehr_custom_assessment_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.ehr_custom_assessments_touch();

ALTER TABLE public.ehr_custom_assessment_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_assessments_all ON public.ehr_custom_assessment_templates;
CREATE POLICY custom_assessments_all ON public.ehr_custom_assessment_templates
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

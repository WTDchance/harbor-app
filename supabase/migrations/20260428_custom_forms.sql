-- Wave 47 / T2 — custom forms / questionnaire builder.
--
-- Practices build any kind of form — intake questions, ROI request
-- templates, custom screeners, post-session reflections, satisfaction
-- surveys. Distinct from W46 T4 custom assessments because forms
-- aren't scored — they're collected data.
--
-- Reuses the W46 T4 question shape (likert_1_5, likert_0_4, yes_no,
-- numeric, free_text, multiple_choice) so the builder UX is shared.

CREATE TABLE IF NOT EXISTS public.ehr_custom_forms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  description     TEXT,
  kind            TEXT NOT NULL DEFAULT 'custom'
                    CHECK (kind IN ('intake','reflection','satisfaction','roi_request','custom')),

  -- Question schema mirrors W46 T4 ehr_custom_assessment_templates.
  -- See lib/aws/ehr/assessments/score.ts::Question for the field
  -- definitions; forms reuse the same validator (without scoring).
  questions       JSONB NOT NULL DEFAULT '[]'::jsonb,

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_forms_practice_active
  ON public.ehr_custom_forms (practice_id, is_active)
  WHERE is_active = TRUE;

CREATE OR REPLACE FUNCTION public.ehr_custom_forms_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ehr_custom_forms_touch ON public.ehr_custom_forms;
CREATE TRIGGER trg_ehr_custom_forms_touch
  BEFORE UPDATE ON public.ehr_custom_forms
  FOR EACH ROW EXECUTE FUNCTION public.ehr_custom_forms_touch();

ALTER TABLE public.ehr_custom_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_forms_all ON public.ehr_custom_forms;
CREATE POLICY custom_forms_all ON public.ehr_custom_forms
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Form responses. One row per (form, patient, attempt). Forms can
-- be re-administered (e.g. monthly satisfaction); we don't UPSERT.
CREATE TABLE IF NOT EXISTS public.ehr_custom_form_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  form_id         UUID NOT NULL REFERENCES public.ehr_custom_forms(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id)         ON DELETE CASCADE,

  responses       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Who did the submitting. Forms can be filled by therapist (intake
  -- on a phone call) or by the patient via the portal.
  submitted_by    TEXT NOT NULL DEFAULT 'patient'
                    CHECK (submitted_by IN ('patient','therapist','system')),
  submitted_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Optional link to the send-event that produced this response.
  -- ehr_custom_form_sends tracked separately is overkill — we just
  -- store the timestamp the patient first opened the form (if any).
  opened_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_form_responses_form
  ON public.ehr_custom_form_responses (form_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_responses_patient
  ON public.ehr_custom_form_responses (practice_id, patient_id, submitted_at DESC);

ALTER TABLE public.ehr_custom_form_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_form_responses_select ON public.ehr_custom_form_responses;
CREATE POLICY custom_form_responses_select ON public.ehr_custom_form_responses
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Patient-portal INSERT goes through service-role API (no Cognito),
-- same pattern as W46 T5 daily check-ins.

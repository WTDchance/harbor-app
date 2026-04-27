-- Wave 42 / T3 — letter templates v1 (disability, school, court).
--
-- Therapists get asked for these constantly. Template-with-merge-
-- fields system: practice authors a body_md_template containing
-- placeholders like {{patient_name}}, {{patient_dob}}, the therapist
-- generates a letter, the system resolves placeholders and renders
-- a PDF.
--
-- ESA letters are deliberately excluded from v1 — they have real
-- legal liability around treating-relationship and medical-
-- necessity requirements. Add them later as a 4th kind with strong
-- caveats in the UI.

CREATE TABLE IF NOT EXISTS public.ehr_letter_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  kind            TEXT NOT NULL
                    CHECK (kind IN ('disability','school_accommodation','court')),
  name            TEXT NOT NULL,
  body_md_template TEXT NOT NULL,

  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived     BOOLEAN NOT NULL DEFAULT FALSE,

  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ehr_letter_templates IS
  'Practice-authored letter templates with merge-field placeholders. '
  'V1 supports disability, school_accommodation, court. ESA letters '
  'deliberately excluded — legal liability around treating-relationship '
  'and medical-necessity requirements.';

CREATE INDEX IF NOT EXISTS idx_letter_templates_practice_kind
  ON public.ehr_letter_templates (practice_id, kind)
  WHERE is_archived = FALSE;
-- One default per (practice, kind).
CREATE UNIQUE INDEX IF NOT EXISTS uq_letter_templates_default
  ON public.ehr_letter_templates (practice_id, kind)
  WHERE is_default = TRUE AND is_archived = FALSE;

CREATE OR REPLACE FUNCTION public.letter_templates_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_letter_templates_touch ON public.ehr_letter_templates;
CREATE TRIGGER trg_letter_templates_touch
  BEFORE UPDATE ON public.ehr_letter_templates
  FOR EACH ROW EXECUTE FUNCTION public.letter_templates_touch();

ALTER TABLE public.ehr_letter_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS letter_templates_select ON public.ehr_letter_templates;
CREATE POLICY letter_templates_select ON public.ehr_letter_templates
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS letter_templates_insert ON public.ehr_letter_templates;
CREATE POLICY letter_templates_insert ON public.ehr_letter_templates
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS letter_templates_update ON public.ehr_letter_templates;
CREATE POLICY letter_templates_update ON public.ehr_letter_templates
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.ehr_letters (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  practice_id         UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  template_id         UUID REFERENCES public.ehr_letter_templates(id) ON DELETE SET NULL,

  kind                TEXT NOT NULL
                        CHECK (kind IN ('disability','school_accommodation','court')),
  -- Snapshot of the resolved body at generation time so historical
  -- letters survive template edits / template deletion.
  body_md_resolved    TEXT NOT NULL,

  generated_by        UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  signed_at           TIMESTAMPTZ,
  signed_by           UUID REFERENCES public.users(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_letters_patient
  ON public.ehr_letters (patient_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_letters_practice_kind
  ON public.ehr_letters (practice_id, kind);

ALTER TABLE public.ehr_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS letters_select ON public.ehr_letters;
CREATE POLICY letters_select ON public.ehr_letters
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS letters_insert ON public.ehr_letters;
CREATE POLICY letters_insert ON public.ehr_letters
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS letters_update ON public.ehr_letters;
CREATE POLICY letters_update ON public.ehr_letters
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- No DELETE — historical evidence of what was issued.

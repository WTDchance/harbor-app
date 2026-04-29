-- Wave 49 / D1 — Custom Forms Builder.
--
-- Practices build their own intake / screening / consent forms beyond
-- the fixed set (PHQ-9 / GAD-7 / biopsychosocial / consent docs).
--
-- Three tables:
--   * practice_custom_forms           — the form definition (schema JSONB)
--   * patient_custom_form_assignments — sent-to-patient row, with portal token
--   * patient_custom_form_responses   — patient's submitted answers
--
-- Practice-scoped RLS on all three. Portal access goes through the
-- random per-assignment token, never RLS — the API route validates
-- the token and switches to the service role.

CREATE TABLE IF NOT EXISTS public.practice_custom_forms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  description  TEXT,

  -- Array of fields. Validated at the API boundary against
  -- lib/ehr/custom-forms.ts -> CUSTOM_FORM_FIELD_TYPES.
  -- Shape: [{ id, type, label, required, options?, validation?: {min,max,regex} }]
  schema       JSONB NOT NULL DEFAULT '[]'::jsonb,

  status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'published', 'archived')),

  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,

  CONSTRAINT practice_custom_forms_slug_per_practice UNIQUE (practice_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_custom_forms_practice
  ON public.practice_custom_forms (practice_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.practice_custom_forms_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_practice_custom_forms_updated_at ON public.practice_custom_forms;
CREATE TRIGGER trg_practice_custom_forms_updated_at
  BEFORE UPDATE ON public.practice_custom_forms
  FOR EACH ROW EXECUTE FUNCTION public.practice_custom_forms_touch();

ALTER TABLE public.practice_custom_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_custom_forms_all ON public.practice_custom_forms;
CREATE POLICY practice_custom_forms_all ON public.practice_custom_forms
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));


-- Assignments: one row per (form, patient, send-instance). Generates a
-- portal token the patient uses to submit without logging in.
CREATE TABLE IF NOT EXISTS public.patient_custom_form_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  form_id         UUID NOT NULL REFERENCES public.practice_custom_forms(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,

  token           TEXT NOT NULL UNIQUE,
  token_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),

  status          TEXT NOT NULL DEFAULT 'sent'
                    CHECK (status IN ('sent', 'opened', 'submitted', 'expired', 'cancelled')),

  -- Snapshot the schema at send time so subsequent edits to the form
  -- don't retroactively change what the patient agreed to fill out.
  schema_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,

  sent_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at       TIMESTAMPTZ,
  submitted_at    TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_form_assign_patient
  ON public.patient_custom_form_assignments (practice_id, patient_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_form_assign_form
  ON public.patient_custom_form_assignments (practice_id, form_id, sent_at DESC);

CREATE OR REPLACE FUNCTION public.patient_custom_form_assignments_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_patient_custom_form_assignments_updated_at ON public.patient_custom_form_assignments;
CREATE TRIGGER trg_patient_custom_form_assignments_updated_at
  BEFORE UPDATE ON public.patient_custom_form_assignments
  FOR EACH ROW EXECUTE FUNCTION public.patient_custom_form_assignments_touch();

ALTER TABLE public.patient_custom_form_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_custom_form_assignments_all ON public.patient_custom_form_assignments;
CREATE POLICY patient_custom_form_assignments_all ON public.patient_custom_form_assignments
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));


-- Responses: one row per submitted assignment. Patient may resubmit
-- (status -> opened then submitted again); we keep the latest response
-- on the assignment, with prior versions appended to a history JSONB array.
CREATE TABLE IF NOT EXISTS public.patient_custom_form_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  assignment_id   UUID NOT NULL REFERENCES public.patient_custom_form_assignments(id) ON DELETE CASCADE,
  form_id         UUID NOT NULL REFERENCES public.practice_custom_forms(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,

  response        JSONB NOT NULL DEFAULT '{}'::jsonb,
  history         JSONB NOT NULL DEFAULT '[]'::jsonb,

  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_ip    TEXT,
  submitted_user_agent TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT patient_custom_form_responses_one_per_assignment UNIQUE (assignment_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_form_resp_patient
  ON public.patient_custom_form_responses (practice_id, patient_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_form_resp_form
  ON public.patient_custom_form_responses (practice_id, form_id, submitted_at DESC);

CREATE OR REPLACE FUNCTION public.patient_custom_form_responses_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_patient_custom_form_responses_updated_at ON public.patient_custom_form_responses;
CREATE TRIGGER trg_patient_custom_form_responses_updated_at
  BEFORE UPDATE ON public.patient_custom_form_responses
  FOR EACH ROW EXECUTE FUNCTION public.patient_custom_form_responses_touch();

ALTER TABLE public.patient_custom_form_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_custom_form_responses_all ON public.patient_custom_form_responses;
CREATE POLICY patient_custom_form_responses_all ON public.patient_custom_form_responses
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.practice_custom_forms IS
  'W49 D1 — practice-built intake/screening/consent forms.';

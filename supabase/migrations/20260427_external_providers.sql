-- Wave 40 / P3 — External provider directory.
--
-- Per-practice catalogue of outside providers a patient may be
-- coordinating care with: primary care physicians, psychiatrists,
-- schools, attorneys, etc. Used for ROI / coordination-of-care work
-- and as targets for fax / email later.
--
-- Two tables:
--   1. ehr_external_providers — practice-scoped catalogue.
--   2. ehr_patient_external_providers — link table (M:N) with the
--      role this provider plays for THIS patient (may differ from
--      the catalogue's primary role) and an active flag.
--
-- Plus an additive ALTER TABLE on ehr_discharge_summaries that adds
-- referral_provider_ids UUID[] WITHOUT touching the existing
-- referrals TEXT column (back-compat per Wave 40 P3 brief).

CREATE TABLE IF NOT EXISTS public.ehr_external_providers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  npi             TEXT,
  role            TEXT NOT NULL
                    CHECK (role IN ('pcp','psychiatrist','school','attorney','other')),
  organization    TEXT,
  phone           TEXT,
  fax             TEXT,
  email           TEXT,
  address         TEXT,
  notes           TEXT,

  -- Lifecycle. We don't hard-delete external providers because
  -- they may be referenced by historical discharge_summaries.referral_provider_ids
  -- and patient_external_providers links. DELETE on the table is a
  -- soft delete that flips deleted_at.
  deleted_at      TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ehr_external_providers IS
  'Practice-scoped directory of outside providers (PCPs, psychiatrists, '
  'schools, attorneys). Link to patients via ehr_patient_external_providers.';

CREATE INDEX IF NOT EXISTS idx_ext_provider_practice
  ON public.ehr_external_providers (practice_id, role)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.ext_provider_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ext_provider_touch ON public.ehr_external_providers;
CREATE TRIGGER trg_ext_provider_touch
  BEFORE UPDATE ON public.ehr_external_providers
  FOR EACH ROW EXECUTE FUNCTION public.ext_provider_touch();

ALTER TABLE public.ehr_external_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ext_provider_select ON public.ehr_external_providers;
CREATE POLICY ext_provider_select ON public.ehr_external_providers
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS ext_provider_insert ON public.ehr_external_providers;
CREATE POLICY ext_provider_insert ON public.ehr_external_providers
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS ext_provider_update ON public.ehr_external_providers;
CREATE POLICY ext_provider_update ON public.ehr_external_providers
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Link table: which external providers does THIS patient see?
CREATE TABLE IF NOT EXISTS public.ehr_patient_external_providers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id               UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  external_provider_id     UUID NOT NULL REFERENCES public.ehr_external_providers(id) ON DELETE RESTRICT,

  -- The role this external provider plays for THIS patient. May differ
  -- from the catalogue's role (e.g. an attorney could be on a patient's
  -- record as a 'school' role contact in unusual cases).
  role_on_patient          TEXT NOT NULL
                             CHECK (role_on_patient IN ('pcp','psychiatrist','school','attorney','other')),
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  notes                    TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (patient_id, external_provider_id, role_on_patient)
);

CREATE INDEX IF NOT EXISTS idx_pep_patient
  ON public.ehr_patient_external_providers (patient_id, active);
CREATE INDEX IF NOT EXISTS idx_pep_provider
  ON public.ehr_patient_external_providers (external_provider_id);

CREATE OR REPLACE FUNCTION public.pep_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_pep_touch ON public.ehr_patient_external_providers;
CREATE TRIGGER trg_pep_touch
  BEFORE UPDATE ON public.ehr_patient_external_providers
  FOR EACH ROW EXECUTE FUNCTION public.pep_touch();

ALTER TABLE public.ehr_patient_external_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pep_select ON public.ehr_patient_external_providers;
CREATE POLICY pep_select ON public.ehr_patient_external_providers
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS pep_insert ON public.ehr_patient_external_providers;
CREATE POLICY pep_insert ON public.ehr_patient_external_providers
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS pep_update ON public.ehr_patient_external_providers;
CREATE POLICY pep_update ON public.ehr_patient_external_providers
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS pep_delete ON public.ehr_patient_external_providers;
CREATE POLICY pep_delete ON public.ehr_patient_external_providers
  FOR DELETE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Discharge-summary referrals: forward-use UUID[] alongside the
-- existing free-text referrals column. Per Wave 40 P3 brief: do NOT
-- touch the existing column.
ALTER TABLE public.ehr_discharge_summaries
  ADD COLUMN IF NOT EXISTS referral_provider_ids UUID[];

COMMENT ON COLUMN public.ehr_discharge_summaries.referral_provider_ids IS
  'Forward-use array of ehr_external_providers.id. The legacy '
  'referrals TEXT column is preserved and may still be populated.';

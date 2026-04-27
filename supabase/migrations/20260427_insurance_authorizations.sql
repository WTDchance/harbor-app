-- Wave 40 / P1 — Insurance authorization tracking.
--
-- Pre-authorization records for commercial insurance plans that gate
-- payment on documented authorization. Eligibility (ehr_eligibility_*)
-- tells you the policy is active; authorization tells you these visits
-- are paid.
--
-- One patient can have multiple concurrent auths (different payers /
-- different CPT scopes / sequential renewals). Sessions are consumed
-- at scheduling time per the Wave 40 brief.

CREATE TABLE IF NOT EXISTS public.ehr_insurance_authorizations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id               UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  payer                    TEXT NOT NULL,
  auth_number              TEXT NOT NULL,
  sessions_authorized      INTEGER NOT NULL CHECK (sessions_authorized >= 0),
  sessions_used            INTEGER NOT NULL DEFAULT 0 CHECK (sessions_used >= 0),

  valid_from               DATE,
  valid_to                 DATE,

  -- Empty array means "covers all CPTs" (use sparingly — most payers
  -- authorize specific procedure codes). Populated codes restrict
  -- consumption to those CPTs.
  cpt_codes_covered        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  notes                    TEXT,

  -- Lifecycle states. 'exhausted' is set automatically when sessions_used
  -- reaches sessions_authorized. 'superseded' is operator-set when a
  -- renewal auth replaces an active one.
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','expired','exhausted','superseded')),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ehr_insurance_authorizations IS
  'Commercial insurance pre-authorizations. Sessions_used increments at '
  'appointment-scheduling time when the appointment CPT matches '
  'cpt_codes_covered (or cpt_codes_covered is empty). status flips to '
  'exhausted automatically.';

CREATE INDEX IF NOT EXISTS idx_auth_patient_status
  ON public.ehr_insurance_authorizations (patient_id, status);
CREATE INDEX IF NOT EXISTS idx_auth_practice_active
  ON public.ehr_insurance_authorizations (practice_id, status, valid_to)
  WHERE status = 'active';
-- Per-patient unique auth_number guard so the same auth isn't double-recorded.
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_patient_number
  ON public.ehr_insurance_authorizations (patient_id, auth_number);

CREATE OR REPLACE FUNCTION public.auth_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_auth_touch ON public.ehr_insurance_authorizations;
CREATE TRIGGER trg_auth_touch
  BEFORE UPDATE ON public.ehr_insurance_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.auth_touch();

ALTER TABLE public.ehr_insurance_authorizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select ON public.ehr_insurance_authorizations;
CREATE POLICY auth_select ON public.ehr_insurance_authorizations
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS auth_insert ON public.ehr_insurance_authorizations;
CREATE POLICY auth_insert ON public.ehr_insurance_authorizations
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS auth_update ON public.ehr_insurance_authorizations;
CREATE POLICY auth_update ON public.ehr_insurance_authorizations
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

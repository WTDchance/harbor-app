-- Wave 49 / T4 — therapist credentialing depth.
--
-- W42 ehr_week6b already added license_* / npi / ceu_* columns to
-- the therapists table (operational source of truth for clinicians).
-- W49 T4 extends to users (any practice user can hold credentials —
-- supervisors, group-practice owners — not just rows in therapists),
-- adds caqh_id + dea_number, and ships ehr_continuing_education for
-- per-course tracking beyond the rolling YTD counter.

-- 1. Per-user credentialing fields. Existing rows get NULL; the
-- /dashboard/settings/credentials page lets users fill them in.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS npi                TEXT,
  ADD COLUMN IF NOT EXISTS license_type       TEXT,
  ADD COLUMN IF NOT EXISTS license_number     TEXT,
  ADD COLUMN IF NOT EXISTS license_state      TEXT,
  ADD COLUMN IF NOT EXISTS license_expires_at DATE,
  ADD COLUMN IF NOT EXISTS caqh_id            TEXT,
  ADD COLUMN IF NOT EXISTS dea_number         TEXT;

COMMENT ON COLUMN public.users.npi IS
  '10-digit NPI. Stored on users (in addition to therapists.npi) so '
  'non-therapist users (supervisors, owners) can hold an NPI for '
  'billing or supervision attestation purposes.';
COMMENT ON COLUMN public.users.dea_number IS
  'DEA registration number. NULL for most psychotherapy users; only '
  'psychiatry / prescribing roles populate it. Format: 2 letters + 7 digits.';
COMMENT ON COLUMN public.users.caqh_id IS
  'CAQH ProView provider ID. Used by payer credentialing applications.';

CREATE INDEX IF NOT EXISTS idx_users_license_expiry
  ON public.users (practice_id, license_expires_at)
  WHERE license_expires_at IS NOT NULL;

-- 2. Continuing education tracker. One row per course completed.
-- Drives a real audit trail when a state board requests CE proof.
CREATE TABLE IF NOT EXISTS public.ehr_continuing_education (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  course_name     TEXT NOT NULL CHECK (char_length(course_name) BETWEEN 1 AND 300),
  provider        TEXT,
  completion_date DATE NOT NULL,
  hours           NUMERIC(5,2) NOT NULL CHECK (hours > 0 AND hours <= 200),

  -- Optional pointer to the certificate. We store the URL only;
  -- actual certificate PDFs go through the W43 T2 patient_documents
  -- bucket pattern (out of scope here).
  certificate_url TEXT,

  -- The CE 'audit year' the course counts toward. Most state boards
  -- run on a 2-year cycle but report yearly; this keeps the rollup
  -- query straightforward.
  audit_year      INTEGER NOT NULL,

  notes           TEXT,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_continuing_education_user_year
  ON public.ehr_continuing_education (user_id, audit_year, completion_date DESC);
CREATE INDEX IF NOT EXISTS idx_continuing_education_practice_recent
  ON public.ehr_continuing_education (practice_id, completion_date DESC);

CREATE OR REPLACE FUNCTION public.ehr_continuing_education_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_continuing_education_touch ON public.ehr_continuing_education;
CREATE TRIGGER trg_continuing_education_touch
  BEFORE UPDATE ON public.ehr_continuing_education
  FOR EACH ROW EXECUTE FUNCTION public.ehr_continuing_education_touch();

ALTER TABLE public.ehr_continuing_education ENABLE ROW LEVEL SECURITY;

-- Therapists see their own rows; admins see the practice's.
DROP POLICY IF EXISTS continuing_education_self_or_admin ON public.ehr_continuing_education;
CREATE POLICY continuing_education_self_or_admin ON public.ehr_continuing_education
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR practice_id IN (
      SELECT practice_id FROM public.users WHERE id = auth.uid()
        AND role IN ('owner', 'admin', 'supervisor')
    )
  );

DROP POLICY IF EXISTS continuing_education_self_modify ON public.ehr_continuing_education;
CREATE POLICY continuing_education_self_modify ON public.ehr_continuing_education
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid()
              AND practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

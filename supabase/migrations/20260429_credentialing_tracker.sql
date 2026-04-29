-- Wave 49 / D3 — Therapist credentialing tracker.
--
-- Per-therapist tracking of:
--   * licenses (state board + expirations)
--   * specialties (free-form taxonomy chips)
--   * payer enrollments (NPI + payer + enrollment status + dates)
--   * CE credits (course + hours + cert URL)
--
-- All four tables are practice-scoped via the therapist row.
-- A daily cron sweep flags expirations at 60 / 30 / 7 days.

-- ─────────────────────────────────────────────────────────────────────
-- LICENSES
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.therapist_licenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  therapist_id    UUID NOT NULL REFERENCES public.therapists(id) ON DELETE CASCADE,

  -- e.g. 'LCSW', 'LMFT', 'LPC', 'PsyD', 'PhD', 'LMHC', 'LPCC'
  type            TEXT NOT NULL,
  state           TEXT NOT NULL,                       -- 2-char USPS state code
  license_number  TEXT NOT NULL,
  issued_at       DATE,
  expires_at      DATE,

  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'expired', 'suspended', 'inactive')),

  document_url    TEXT,                                -- S3 link to scan/PDF
  notes           TEXT,

  -- Last warning level fired by the cron sweep, so we don't re-fire daily.
  last_warning_threshold INT,                          -- one of 60, 30, 7

  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_therapist_licenses_therapist
  ON public.therapist_licenses (practice_id, therapist_id, expires_at NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_therapist_licenses_expiring
  ON public.therapist_licenses (practice_id, expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.therapist_licenses_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_therapist_licenses_updated_at ON public.therapist_licenses;
CREATE TRIGGER trg_therapist_licenses_updated_at
  BEFORE UPDATE ON public.therapist_licenses
  FOR EACH ROW EXECUTE FUNCTION public.therapist_licenses_touch();

ALTER TABLE public.therapist_licenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS therapist_licenses_all ON public.therapist_licenses;
CREATE POLICY therapist_licenses_all ON public.therapist_licenses
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- SPECIALTIES
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.therapist_specialties (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  therapist_id UUID NOT NULL REFERENCES public.therapists(id) ON DELETE CASCADE,

  -- e.g. 'CBT', 'EMDR', 'Trauma', 'Adolescents', 'Couples', 'PTSD'
  specialty    TEXT NOT NULL,
  certified    BOOLEAN NOT NULL DEFAULT FALSE,         -- holds a formal cert?
  cert_url     TEXT,                                   -- optional

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT therapist_specialty_unique UNIQUE (therapist_id, specialty)
);

CREATE INDEX IF NOT EXISTS idx_therapist_specialties_practice
  ON public.therapist_specialties (practice_id, therapist_id);

ALTER TABLE public.therapist_specialties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS therapist_specialties_all ON public.therapist_specialties;
CREATE POLICY therapist_specialties_all ON public.therapist_specialties
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- PAYER ENROLLMENTS
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.therapist_payer_enrollments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  therapist_id    UUID NOT NULL REFERENCES public.therapists(id) ON DELETE CASCADE,

  payer_name      TEXT NOT NULL,                      -- e.g. 'Aetna', 'BCBS WA'
  payer_id        TEXT,                                -- payer claim ID if known
  npi             TEXT,                                -- 10-digit National Provider ID
  taxonomy_code   TEXT,                                -- e.g. '101YM0800X'

  enrollment_status TEXT NOT NULL DEFAULT 'pending'
                      CHECK (enrollment_status IN ('pending', 'enrolled', 'denied', 'terminated')),

  effective_from  DATE,
  effective_to    DATE,

  notes           TEXT,
  document_url    TEXT,

  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_therapist_payer_enroll_therapist
  ON public.therapist_payer_enrollments (practice_id, therapist_id, enrollment_status);

CREATE OR REPLACE FUNCTION public.therapist_payer_enrollments_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_therapist_payer_enrollments_updated_at ON public.therapist_payer_enrollments;
CREATE TRIGGER trg_therapist_payer_enrollments_updated_at
  BEFORE UPDATE ON public.therapist_payer_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.therapist_payer_enrollments_touch();

ALTER TABLE public.therapist_payer_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS therapist_payer_enrollments_all ON public.therapist_payer_enrollments;
CREATE POLICY therapist_payer_enrollments_all ON public.therapist_payer_enrollments
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────
-- CE CREDITS
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.therapist_ce_credits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  therapist_id    UUID NOT NULL REFERENCES public.therapists(id) ON DELETE CASCADE,

  course_name     TEXT NOT NULL,
  provider        TEXT,                                -- accrediting body
  hours           NUMERIC(6,2) NOT NULL DEFAULT 0,     -- CE hours (allow halves)
  category        TEXT,                                -- e.g. 'ethics', 'cultural', 'general'
  completed_at    DATE NOT NULL,
  cert_url        TEXT,

  notes           TEXT,
  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_therapist_ce_credits_therapist
  ON public.therapist_ce_credits (practice_id, therapist_id, completed_at DESC);

CREATE OR REPLACE FUNCTION public.therapist_ce_credits_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_therapist_ce_credits_updated_at ON public.therapist_ce_credits;
CREATE TRIGGER trg_therapist_ce_credits_updated_at
  BEFORE UPDATE ON public.therapist_ce_credits
  FOR EACH ROW EXECUTE FUNCTION public.therapist_ce_credits_touch();

ALTER TABLE public.therapist_ce_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS therapist_ce_credits_all ON public.therapist_ce_credits;
CREATE POLICY therapist_ce_credits_all ON public.therapist_ce_credits
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

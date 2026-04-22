-- Consent records. HIPAA-defensible when every patient has the required
-- consents signed with version + timestamp + method of signing.
--
-- Common consent_type values:
--   hipaa_npp               -- Notice of Privacy Practices
--   informed_consent        -- General informed consent to treatment
--   telehealth_consent      -- Telehealth-specific
--   sms_consent             -- TCPA-aware SMS communication consent
--   release_of_information  -- ROI to PCP / psychiatrist / other party
--   financial_agreement     -- Fees, cancellation policy, no-show charges

CREATE TABLE IF NOT EXISTS public.ehr_consents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id      UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,

  consent_type     TEXT NOT NULL,
  version          TEXT NOT NULL DEFAULT 'v1',
  document_name    TEXT,                       -- human-readable: "Harbor NPP 2026"
  document_url     TEXT,                       -- optional, link to the document blob

  -- ROI-specific (only populated when consent_type = 'release_of_information')
  roi_party_name   TEXT,
  roi_party_role   TEXT,                       -- e.g. "Primary care physician"
  roi_expires_at   DATE,
  roi_scope        TEXT,                       -- what's authorized to share

  -- Signing metadata
  signed_at        TIMESTAMPTZ,
  signed_by_name   TEXT,                       -- who signed (patient typing name)
  signed_method    TEXT CHECK (signed_method IN ('in_person', 'portal', 'sms', 'voice', 'paper_scan')),
  signature_ip     INET,
  signature_hash   TEXT,

  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'signed', 'revoked', 'expired')),
  revoked_at       TIMESTAMPTZ,
  revoked_reason   TEXT,

  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_consents_practice_patient
  ON public.ehr_consents (practice_id, patient_id, consent_type, status);

CREATE OR REPLACE FUNCTION public.ehr_consents_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_consents_touch ON public.ehr_consents;
CREATE TRIGGER trg_ehr_consents_touch
  BEFORE UPDATE ON public.ehr_consents
  FOR EACH ROW EXECUTE FUNCTION public.ehr_consents_touch();

ALTER TABLE public.ehr_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehr_consents_select ON public.ehr_consents;
CREATE POLICY ehr_consents_select ON public.ehr_consents FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_consents_insert ON public.ehr_consents;
CREATE POLICY ehr_consents_insert ON public.ehr_consents FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_consents_update ON public.ehr_consents;
CREATE POLICY ehr_consents_update ON public.ehr_consents FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

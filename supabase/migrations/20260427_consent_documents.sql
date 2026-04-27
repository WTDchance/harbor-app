-- Wave 38 TS4 — versioned consent documents + per-patient electronic
-- signatures.
--
-- ehr_consents (Wave 14) tracked WHICH consent types a patient has on
-- file. This wave adds the source-of-truth documents themselves
-- (consent_documents) and the binding signatures (consent_signatures)
-- so the patient portal can render the latest version of each required
-- doc and capture an actual signature image at sign time.
--
-- Document kinds (open-ended TEXT, but the UI ships these four):
--   hipaa_npp                -- Notice of Privacy Practices
--   telehealth               -- Telehealth-specific consent
--   financial_responsibility -- Fees / cancellation / no-show
--   roi                      -- Release of Information

CREATE TABLE IF NOT EXISTS public.consent_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id   UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  version       TEXT NOT NULL DEFAULT 'v1',
  body_md       TEXT NOT NULL,
  effective_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  required      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Most queries: "what's the active document for kind X in practice P?"
CREATE INDEX IF NOT EXISTS idx_consent_docs_practice_kind
  ON public.consent_documents (practice_id, kind, effective_at DESC);

CREATE TABLE IF NOT EXISTS public.consent_signatures (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         UUID NOT NULL REFERENCES public.consent_documents(id) ON DELETE RESTRICT,
  patient_id          UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  signed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signature_data_url  TEXT NOT NULL,         -- canvas drawing as data URL
  signed_name         TEXT,                  -- typed name accompaniment
  ip                  INET,
  user_agent          TEXT
);

CREATE INDEX IF NOT EXISTS idx_consent_sigs_patient
  ON public.consent_signatures (patient_id, signed_at DESC);

CREATE INDEX IF NOT EXISTS idx_consent_sigs_doc
  ON public.consent_signatures (document_id, patient_id);

-- A patient should only sign a given document version once. Enforce.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_sigs_doc_patient
  ON public.consent_signatures (document_id, patient_id);

ALTER TABLE public.consent_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_signatures ENABLE ROW LEVEL SECURITY;

-- v1 RLS: service-role only (matches the rest of the EHR tables; the API
-- layer enforces practice scoping via requireEhrApiSession /
-- requirePortalSession before doing the query).
DROP POLICY IF EXISTS consent_docs_service ON public.consent_documents;
CREATE POLICY consent_docs_service ON public.consent_documents FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS consent_sigs_service ON public.consent_signatures;
CREATE POLICY consent_sigs_service ON public.consent_signatures FOR ALL TO service_role USING (true) WITH CHECK (true);

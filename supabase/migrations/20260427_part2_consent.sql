-- Wave 41 — 42 CFR Part 2 separate consent track.
--
-- Background: SUD records covered by 42 CFR Part 2 require a written,
-- signed consent that names the recipient, the purpose, the kind/amount
-- of information, an expiration, the right to revoke, and a notice
-- prohibiting re-disclosure. This is *separate* from HIPAA NPP and even
-- separate from the generic ROI consent — Part 2 has its own statutory
-- requirements and its own re-disclosure prohibition that must travel
-- with every disclosure.
--
-- Approach:
--   1. Reuse the existing Wave 38 TS4 generic consent system
--      (consent_documents + consent_signatures). The kind column is
--      open-ended TEXT (no CHECK constraint), so no schema change is
--      needed there — we just add '42_cfr_part2' as a new application
--      kind. Add consent_signatures.metadata JSONB and revoked_at so the
--      structured Part 2 fields and revocation can live alongside the
--      generic signature record.
--   2. New table ehr_part2_disclosures records every disclosure made
--      under an active Part 2 consent (auditing the disclosure event,
--      the recipient, what was sent, and whether the recipient
--      acknowledged the re-disclosure prohibition).

-- 1. Extend consent_signatures with metadata + revocation. The generic
--    signature shape is fine for HIPAA / telehealth / etc., but Part 2
--    needs structured fields (recipient, purpose, expiration, ...) that
--    we validate at the API write boundary, not at the DB layer (keeps
--    the schema generic so future kinds can do the same trick).
ALTER TABLE public.consent_signatures
  ADD COLUMN IF NOT EXISTS metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.consent_signatures
  ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMPTZ;

ALTER TABLE public.consent_signatures
  ADD COLUMN IF NOT EXISTS revoked_by  UUID REFERENCES public.users(id);

-- The unique-doc-per-patient index on consent_signatures is fine for
-- HIPAA-style consents (one active sig per doc), but Part 2 consents are
-- per-recipient — a patient may sign two Part 2 consents against the
-- same template (e.g. two different recipients). Allow that by relaxing
-- the unique index to the non-Part-2 kinds.
DROP INDEX IF EXISTS public.uq_consent_sigs_doc_patient;

CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_sigs_doc_patient_non_part2
  ON public.consent_signatures (document_id, patient_id)
  WHERE (metadata->>'kind') IS DISTINCT FROM '42_cfr_part2';

-- 2. ehr_part2_disclosures — every individual disclosure event.
CREATE TABLE IF NOT EXISTS public.ehr_part2_disclosures (
  id                                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id                                      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  practice_id                                     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  consent_signature_id                            UUID NOT NULL REFERENCES public.consent_signatures(id) ON DELETE RESTRICT,
  disclosed_to                                    TEXT NOT NULL,
  disclosed_at                                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  what_was_disclosed                              TEXT NOT NULL,
  recipient_acknowledged_redisclosure_prohibition BOOLEAN NOT NULL DEFAULT FALSE,
  notes                                           TEXT,
  created_by                                      UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at                                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ehr_part2_disclosures IS
  'One row per 42 CFR Part 2 disclosure event. Every disclosure must '
  'reference an active (non-revoked, non-expired) consent_signatures '
  'row. recipient_acknowledged_redisclosure_prohibition records '
  'whether the recipient was given (and acknowledged) the statutory '
  're-disclosure prohibition notice.';

CREATE INDEX IF NOT EXISTS idx_part2_disc_patient
  ON public.ehr_part2_disclosures (patient_id, disclosed_at DESC);
CREATE INDEX IF NOT EXISTS idx_part2_disc_practice
  ON public.ehr_part2_disclosures (practice_id, disclosed_at DESC);
CREATE INDEX IF NOT EXISTS idx_part2_disc_consent
  ON public.ehr_part2_disclosures (consent_signature_id);

ALTER TABLE public.ehr_part2_disclosures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS part2_disc_service ON public.ehr_part2_disclosures;
CREATE POLICY part2_disc_service ON public.ehr_part2_disclosures
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS part2_disc_select ON public.ehr_part2_disclosures;
CREATE POLICY part2_disc_select ON public.ehr_part2_disclosures
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS part2_disc_insert ON public.ehr_part2_disclosures;
CREATE POLICY part2_disc_insert ON public.ehr_part2_disclosures
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

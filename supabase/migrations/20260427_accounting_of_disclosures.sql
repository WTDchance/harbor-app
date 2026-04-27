-- Wave 41 / T1 — HIPAA Accounting of Disclosures (§164.528).
--
-- 45 CFR §164.528 grants every patient the right to receive an
-- accounting of disclosures of their PHI for the past six years
-- (excluding disclosures for treatment, payment, healthcare
-- operations, and disclosures pursuant to authorization).
--
-- This table is the canonical record from which the patient-facing
-- accounting is generated. Manual entry covers v1; v2 will auto-feed
-- from ehr_part2_disclosures (Wave 41 day-of), ROI consents
-- (consent_signatures), and any other event that disclosed PHI to
-- a third party.
--
-- DELETE is intentionally not exposed — these rows are regulatory
-- evidence. Updates ARE allowed (typo fixes, recipient address
-- corrections) and audited.

CREATE TABLE IF NOT EXISTS public.ehr_disclosure_records (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id               UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  disclosed_by_user_id     UUID NOT NULL REFERENCES public.users(id)    ON DELETE RESTRICT,
  disclosed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  disclosure_kind          TEXT NOT NULL
                             CHECK (disclosure_kind IN (
                               'roi_authorization',     -- patient signed ROI
                               'court_order',           -- subpoena / court order
                               'public_health',         -- mandatory reporting -> public health
                               'law_enforcement',       -- specific law-enforcement requests
                               'workers_comp',
                               'coroner_or_funeral',
                               'research',              -- IRB-approved research
                               'oversight_agency',      -- HHS / state regulator
                               'tarasoff_warning',      -- duty to warn third party
                               'other'
                             )),

  recipient_name           TEXT NOT NULL,
  recipient_address        TEXT,
  purpose                  TEXT NOT NULL,
  description_of_phi       TEXT NOT NULL,
  legal_authority          TEXT, -- citation/reason if not consent-based

  -- Optional link to the consent_signatures row that authorised
  -- this disclosure. NULL when there is no consent (court order,
  -- mandatory reporting, etc.).
  consent_signature_id     UUID REFERENCES public.consent_signatures(id) ON DELETE SET NULL,

  -- 42 CFR Part 2 disclosures need extra protection (re-disclosure
  -- prohibition notice must accompany the PHI). When TRUE, the PDF
  -- generator stamps the row with a Part-2 advisory.
  is_part2_protected       BOOLEAN NOT NULL DEFAULT FALSE,

  -- §164.528(a)(1) lists exclusions from the accounting — most
  -- notably treatment/payment/operations and consented disclosures.
  -- TRUE = appears in the patient's accounting PDF; FALSE = tracked
  -- internally but excluded per the regulation. Default TRUE because
  -- every manually-entered disclosure is presumed accounting-
  -- relevant unless the operator marks it excluded.
  included_in_accounting   BOOLEAN NOT NULL DEFAULT TRUE,

  notes                    TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ehr_disclosure_records IS
  'Accounting of Disclosures per HIPAA §164.528. Manual entry v1; '
  'auto-feeders for ROI signatures + Part 2 disclosures land in v2.';
COMMENT ON COLUMN public.ehr_disclosure_records.included_in_accounting IS
  'TRUE = appears in the patient-facing accounting PDF. FALSE = '
  'tracked internally but excluded per §164.528(a)(1) (treatment, '
  'payment, healthcare operations, or consented disclosures).';

CREATE INDEX IF NOT EXISTS idx_disclosure_records_patient
  ON public.ehr_disclosure_records (patient_id, disclosed_at DESC);
CREATE INDEX IF NOT EXISTS idx_disclosure_records_practice_kind
  ON public.ehr_disclosure_records (practice_id, disclosure_kind);

CREATE OR REPLACE FUNCTION public.disclosure_records_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_disclosure_records_touch ON public.ehr_disclosure_records;
CREATE TRIGGER trg_disclosure_records_touch
  BEFORE UPDATE ON public.ehr_disclosure_records
  FOR EACH ROW EXECUTE FUNCTION public.disclosure_records_touch();

ALTER TABLE public.ehr_disclosure_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dr_select ON public.ehr_disclosure_records;
CREATE POLICY dr_select ON public.ehr_disclosure_records
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS dr_insert ON public.ehr_disclosure_records;
CREATE POLICY dr_insert ON public.ehr_disclosure_records
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS dr_update ON public.ehr_disclosure_records;
CREATE POLICY dr_update ON public.ehr_disclosure_records
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- No DELETE policy — these rows are regulatory evidence.

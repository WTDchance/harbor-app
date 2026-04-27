-- Wave 41 / T4 — Stedi 835 ERA / EOB (Electronic Remittance Advice).
--
-- Inbound payment file processing for in-network practices. After
-- a payer adjudicates submitted claims, they emit an 835 ERA file
-- describing per-claim payments, adjustments, and denials. Stedi
-- normalizes the X12 835 into a JSON envelope and posts it to our
-- webhook.
--
-- Two tables:
--   1. ehr_era_files    — one row per ERA file received.
--   2. ehr_era_claim_payments — one row per claim-payment line
--                              inside the file. Auto-matches to
--                              ehr_invoices by claim_reference (the
--                              identifier the practice sent on the
--                              837); falls back to manual match.

CREATE TABLE IF NOT EXISTS public.ehr_era_files (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  stedi_event_id           TEXT,                         -- Stedi's webhook event id (idempotency)
  stedi_file_id            TEXT,                         -- Stedi's stored file id
  payer_id                 TEXT,                         -- Stedi tradingPartnerServiceId on the file
  payer_name               TEXT,
  check_or_eft_number      TEXT,
  payment_method           TEXT,                         -- 'CHK' | 'ACH' | 'BOP' | etc.
  payment_amount_cents     BIGINT NOT NULL DEFAULT 0,
  payment_date             DATE,

  raw_payload              JSONB,                        -- the full Stedi-normalized 835 JSON for forensic replay

  status                   TEXT NOT NULL DEFAULT 'received'
                             CHECK (status IN ('received','parsed','partially_matched','matched','manual_review','error')),
  parse_error              TEXT,

  received_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  parsed_at                TIMESTAMPTZ,

  UNIQUE (practice_id, stedi_event_id)
);

CREATE INDEX IF NOT EXISTS idx_era_files_practice_status
  ON public.ehr_era_files (practice_id, status, received_at DESC);

ALTER TABLE public.ehr_era_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS era_files_select ON public.ehr_era_files;
CREATE POLICY era_files_select ON public.ehr_era_files
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.ehr_era_claim_payments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  era_file_id              UUID NOT NULL REFERENCES public.ehr_era_files(id) ON DELETE CASCADE,
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  -- Identifiers from the 835 — claim_reference is the key we
  -- auto-match against ehr_invoices.id (set as REF*EA on the 837).
  claim_reference          TEXT,
  patient_account_number   TEXT,
  payer_claim_control_no   TEXT,

  charge_amount_cents      BIGINT NOT NULL DEFAULT 0,
  paid_amount_cents        BIGINT NOT NULL DEFAULT 0,
  patient_responsibility_cents BIGINT NOT NULL DEFAULT 0,

  -- Adjustment reason codes per CARC/RARC.
  adjustments_json         JSONB,
  service_lines_json       JSONB,

  claim_status_code        TEXT,                         -- '1' = primary, '2' = secondary, '3' = tertiary, '4' = denied, etc.

  -- Match state. auto-matched via claim_reference -> ehr_invoices.id;
  -- otherwise unmatched until an operator picks the invoice manually.
  matched_invoice_id       UUID REFERENCES public.ehr_invoices(id) ON DELETE SET NULL,
  match_kind               TEXT NOT NULL DEFAULT 'unmatched'
                             CHECK (match_kind IN ('unmatched','auto','manual')),
  matched_by_user_id       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  matched_at               TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_era_claim_payments_file
  ON public.ehr_era_claim_payments (era_file_id);
CREATE INDEX IF NOT EXISTS idx_era_claim_payments_invoice
  ON public.ehr_era_claim_payments (matched_invoice_id) WHERE matched_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_era_claim_payments_unmatched
  ON public.ehr_era_claim_payments (practice_id, created_at DESC)
  WHERE match_kind = 'unmatched';

ALTER TABLE public.ehr_era_claim_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS era_payments_select ON public.ehr_era_claim_payments;
CREATE POLICY era_payments_select ON public.ehr_era_claim_payments
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS era_payments_update ON public.ehr_era_claim_payments;
CREATE POLICY era_payments_update ON public.ehr_era_claim_payments
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

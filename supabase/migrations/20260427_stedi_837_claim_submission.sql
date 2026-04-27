-- Wave 41 / T5 — Stedi 837 outbound claim submission, invoice-level.
--
-- Pairs with T4 (835 ERA processing). Therapists submit ehr_invoices
-- to insurance via Stedi. The 837 wire shape is per-invoice (bundled
-- charges all paid by one payer) — distinct from the existing per-
-- charge ehr_claims table from Wave 38, which we leave alone.
--
-- We use the existing stedi_payers table (Wave 18) as the payer
-- directory rather than introducing a redundant ehr_payer_directory.

-- 1. Extend ehr_invoices with submission tracking.
ALTER TABLE public.ehr_invoices
  ADD COLUMN IF NOT EXISTS submitted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stedi_submission_id  TEXT,
  ADD COLUMN IF NOT EXISTS submission_status    TEXT
    CHECK (submission_status IN (
      'not_submitted',
      'submitting',
      'accepted',
      'rejected',
      'paid',
      'denied'
    )) DEFAULT 'not_submitted',
  ADD COLUMN IF NOT EXISTS payer_id_837         TEXT;

COMMENT ON COLUMN public.ehr_invoices.submission_status IS
  'Lifecycle of the 837 submission. Distinct from invoices.status '
  '(billing-side: draft/sent/partial/paid/void) and from the old '
  'ehr_claims.status which tracked per-charge submissions in Wave 38.';
COMMENT ON COLUMN public.ehr_invoices.payer_id_837 IS
  'Stedi tradingPartnerServiceId for the 837 — resolved at submit '
  'time from stedi_payers.stedi_id; cached here so resubmissions '
  'don''t re-resolve.';

-- 2. New ehr_claim_submissions — one row per submission attempt.
-- Multiple rows per invoice tolerated for resubmissions (the brief
-- doesn't make these unique by invoice, on purpose: a denied claim
-- gets resubmitted with corrections).
CREATE TABLE IF NOT EXISTS public.ehr_claim_submissions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  invoice_id               UUID NOT NULL REFERENCES public.ehr_invoices(id) ON DELETE CASCADE,
  submitted_by_user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  submitted_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  payer_id_837             TEXT NOT NULL,
  payer_name               TEXT,
  control_number           TEXT NOT NULL,            -- the 9-digit ISA control number sent on the wire

  request_payload_json     JSONB NOT NULL,           -- the JSON we sent Stedi (no PHI redaction; PHI is required for billing)
  response_payload_json    JSONB,                    -- Stedi's response

  stedi_submission_id      TEXT,                     -- Stedi's claim/submission id from the response
  http_status              INTEGER,
  is_accepted              BOOLEAN,                   -- TRUE = Stedi accepted the format; doesn't mean the payer paid
  rejection_reason         TEXT,

  status                   TEXT NOT NULL DEFAULT 'submitting'
                             CHECK (status IN (
                               'submitting','accepted','rejected','error'
                             )),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_submissions_invoice
  ON public.ehr_claim_submissions (invoice_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_claim_submissions_practice_status
  ON public.ehr_claim_submissions (practice_id, status, submitted_at DESC);

ALTER TABLE public.ehr_claim_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS claim_submissions_select ON public.ehr_claim_submissions;
CREATE POLICY claim_submissions_select ON public.ehr_claim_submissions
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS claim_submissions_insert ON public.ehr_claim_submissions;
CREATE POLICY claim_submissions_insert ON public.ehr_claim_submissions
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- No UPDATE / DELETE — submissions are historical evidence, like
-- ehr_disclosure_records and audit_logs.

-- Wave 41 / T5 patch — Stedi 837 claim lifecycle (PCN/PCCN/CFC,
-- 277CA acknowledgments, resubmission + cancellation linkage).
--
-- Reference: https://www.stedi.com/docs/healthcare/resubmit-cancel-claims
--
-- Original W41 T5 (20260427_stedi_837_claim_submission.sql) created
-- ehr_claim_submissions. That table treated invoice.id as the
-- patientControlNumber, which is wrong on two counts:
--   1. Stedi requires the PCN to be ≤17 chars X12 Basic charset
--      (uppercase + digits) — UUIDs blow that constraint.
--   2. Without a PCN we own, we can't satisfy the resubmission rules
--      (reuse-PCN for pre-adj / Medicare; new-PCN for non-Medicare adj).
--
-- This migration adds:
--   • pcn (the X12-safe identifier we generate per submission)
--   • payer_claim_control_number (PCCN — captured from 277CA / 835)
--   • acknowledgment_status / received_at / messages
--   • is_in_adjudication (true once a PCCN is assigned)
--   • original_submission_id (resubmissions point back to first try)
--   • is_cancellation (CFC=8 submissions)
--   • stedi_payers.is_medicare (Medicare branch in the resubmit matrix)
--
-- Idempotent. Backfills existing rows with random Basic-charset PCNs.

BEGIN;

-- 1. Backfill helper — random 17-char Basic charset string.
--    Used only for the existing-row backfill below; runtime PCN
--    generation lives in Node so the same helper isn't relied on
--    by app code.
CREATE OR REPLACE FUNCTION public.__harbor_random_pcn() RETURNS TEXT
LANGUAGE plpgsql AS $fn$
DECLARE
  charset TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  out TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..17 LOOP
    out := out || substr(charset, 1 + (floor(random() * length(charset))::int), 1);
  END LOOP;
  RETURN out;
END $fn$;

-- 2. ehr_claim_submissions — new lifecycle columns.
ALTER TABLE public.ehr_claim_submissions
  ADD COLUMN IF NOT EXISTS pcn                          TEXT,
  ADD COLUMN IF NOT EXISTS payer_claim_control_number   TEXT,
  ADD COLUMN IF NOT EXISTS acknowledgment_status        TEXT,
  ADD COLUMN IF NOT EXISTS acknowledgment_received_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledgment_messages      JSONB,
  ADD COLUMN IF NOT EXISTS is_in_adjudication           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS original_submission_id       UUID REFERENCES public.ehr_claim_submissions(id),
  ADD COLUMN IF NOT EXISTS is_cancellation              BOOLEAN NOT NULL DEFAULT false;

-- Backfill any historical rows so we can apply NOT NULL.
UPDATE public.ehr_claim_submissions
   SET pcn = public.__harbor_random_pcn()
 WHERE pcn IS NULL;

-- Apply NOT NULL constraint and acknowledgment_status check.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ehr_claim_submissions'
       AND column_name='pcn' AND is_nullable='NO'
  ) THEN
    EXECUTE 'ALTER TABLE public.ehr_claim_submissions ALTER COLUMN pcn SET NOT NULL';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ehr_claim_submissions_ack_status_chk'
  ) THEN
    EXECUTE 'ALTER TABLE public.ehr_claim_submissions
              ADD CONSTRAINT ehr_claim_submissions_ack_status_chk
              CHECK (acknowledgment_status IS NULL
                     OR acknowledgment_status IN (''accepted'',''rejected'',''pending''))';
  END IF;
END $$;

COMMENT ON COLUMN public.ehr_claim_submissions.pcn IS
  '17-char X12-Basic-charset identifier we generate (PCN). Reused per '
  'Stedi resubmission rules: same PCN for pre-adj or Medicare, new PCN '
  'for non-Medicare adjudication.';
COMMENT ON COLUMN public.ehr_claim_submissions.payer_claim_control_number IS
  'PCCN — payer''s identifier captured from 277CA tradingPartnerClaimNumber '
  'or 835 payerClaimControlNumber. Required on non-Medicare adjudication '
  'resubmissions; omitted for pre-adj and Medicare.';
COMMENT ON COLUMN public.ehr_claim_submissions.acknowledgment_status IS
  'accepted | rejected | pending — set by /api/stedi/277ca-webhook when '
  'the 277CA arrives.';
COMMENT ON COLUMN public.ehr_claim_submissions.is_in_adjudication IS
  'TRUE once a PCCN was assigned (277CA or 835 returned a payer claim '
  'control number). Drives the resubmit/cancel CFC computation.';
COMMENT ON COLUMN public.ehr_claim_submissions.original_submission_id IS
  'Self-FK back to the first submission for this lineage. NULL on the '
  'original; set on every resubmission/cancellation.';
COMMENT ON COLUMN public.ehr_claim_submissions.is_cancellation IS
  'TRUE for CFC=8 cancellation submissions. Distinct from is_accepted '
  '(Stedi format-acceptance) and submission_status (lifecycle).';

-- 3. Index for the rejected-claims dashboard tile.
CREATE INDEX IF NOT EXISTS idx_claim_submissions_ack_status
  ON public.ehr_claim_submissions (practice_id, acknowledgment_status, acknowledgment_received_at DESC);

-- 4. Lookup index for 277CA webhook PCN matching.
CREATE INDEX IF NOT EXISTS idx_claim_submissions_pcn
  ON public.ehr_claim_submissions (pcn);

-- 5. Allow UPDATE-by-service-role for the 277CA webhook to set
--    acknowledgment fields. The original W41 T5 RLS policy intentionally
--    excluded UPDATE/DELETE because submissions are historical evidence —
--    the 277CA webhook bypasses RLS via the service role, so no extra
--    policy is needed; we just leave it alone.

-- 6. stedi_payers.is_medicare — flagged manually for v1; better Stedi
--    payer-name discovery is a follow-up.
ALTER TABLE public.stedi_payers
  ADD COLUMN IF NOT EXISTS is_medicare BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stedi_payers.is_medicare IS
  'TRUE for Medicare MAC payers. Drives the resubmit/cancel CFC + PCCN '
  'computation: Medicare adjudication uses CFC=1 + reuse-PCN + no PCCN; '
  'non-Medicare adjudication uses CFC=7/8 + new-PCN + include PCCN. v1 '
  'is set manually; future work: derive from Stedi catalog.';

CREATE INDEX IF NOT EXISTS idx_stedi_payers_medicare
  ON public.stedi_payers (is_medicare) WHERE is_medicare = true;

-- 7. Best-effort seed of common Medicare MAC IDs. Operators must
--    augment with their region's MAC payer IDs via SQL after deploy
--    (flagged in PR description).
UPDATE public.stedi_payers
   SET is_medicare = true
 WHERE primary_payer_id IN ('04112','12102','01112','03102','05102','06102','07102','08102','09102','10112','11302','13202')
    OR lower(display_name) LIKE 'medicare %'
    OR lower(display_name) LIKE '%medicare administrative contractor%';

COMMIT;

-- Drop the temporary backfill helper — runtime PCN generation lives
-- in Node (lib/ehr/stedi-claim.ts).
DROP FUNCTION IF EXISTS public.__harbor_random_pcn();

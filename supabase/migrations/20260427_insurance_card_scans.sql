-- ============================================================
-- Harbor EHR — insurance card scans
--
-- Stores the full history of every insurance-card scan we run for
-- a patient. The patient row's existing insurance_* columns remain
-- the source of truth for "current insurance"; this table preserves
-- raw scan artefacts (S3 keys for the original images, the raw
-- Textract JSON, parsed key/value pairs, confidence scores) so we
-- can re-extract / audit later without re-uploading.
--
-- HIPAA notes:
--   * Original front/back images live in a dedicated KMS-encrypted
--     S3 bucket (terraform: insurance-card-scans-bucket.tf). 90-day
--     hot lifecycle then transition to Glacier; never deleted by
--     this table — S3 lifecycle is the system of record for image
--     retention.
--   * Textract is HIPAA-eligible under the existing AWS BAA. No
--     image bytes leave AWS.
--   * Every scan also writes an audit_logs row via lib/aws/ehr/audit.ts
--     (`insurance_card.scanned`).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ehr_insurance_card_scans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id         UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  scanned_by_user_id  UUID,  -- auth.users(id) — no FK so auth schema stays decoupled

  -- S3 object keys for the original images. Either side may be NULL
  -- if the therapist only scanned one side, but at least one must be
  -- non-null (enforced at app layer + below check).
  front_s3_key        TEXT,
  back_s3_key         TEXT,

  -- Parsed fields from Textract AnalyzeDocument FORMS pass.
  -- Stored as a flat JSONB for forward-compat as we add payers /
  -- field heuristics. Known keys (see route.ts parser):
  --   member_id, group_number, member_name, plan_name, plan_type,
  --   payer_name, effective_date, rx_bin, rx_pcn, rx_group,
  --   customer_service_phone, provider_service_phone
  scan_data           JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Per-field confidence (0..1) keyed by the same field names as
  -- scan_data, plus the raw Textract response for forensic re-parse.
  field_confidence    JSONB NOT NULL DEFAULT '{}'::jsonb,
  textract_raw        JSONB,

  -- Aggregate confidence — min() of field_confidence values,
  -- precomputed so the UI can sort/filter without scanning JSON.
  confidence          NUMERIC(4,3),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ehr_insurance_card_scans_at_least_one_side
    CHECK (front_s3_key IS NOT NULL OR back_s3_key IS NOT NULL)
);

COMMENT ON TABLE public.ehr_insurance_card_scans IS
  'Per-scan record of insurance-card image uploads + Textract extraction. '
  'Re-scans append rows; the patient row''s insurance_* columns are the '
  'source of truth for "current insurance". Originals live in the KMS-'
  'encrypted insurance-cards S3 bucket.';

COMMENT ON COLUMN public.ehr_insurance_card_scans.scan_data IS
  'Parsed fields extracted from Textract (member_id, group_number, etc.).';
COMMENT ON COLUMN public.ehr_insurance_card_scans.textract_raw IS
  'Raw AnalyzeDocument response (Blocks array + Metadata). For forensic '
  're-parse if extraction heuristics change.';

-- ----- Indexes --------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_ehr_insurance_card_scans_patient
  ON public.ehr_insurance_card_scans (patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ehr_insurance_card_scans_practice
  ON public.ehr_insurance_card_scans (practice_id, created_at DESC);

-- ----- Row Level Security ---------------------------------------------------
--
-- Mirrors ehr_progress_notes (see 20260421_ehr_core.sql): practice members
-- can read/write rows for their own practice; service role bypasses for
-- server-side inserts via the API route.

ALTER TABLE public.ehr_insurance_card_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehr_insurance_card_scans_select ON public.ehr_insurance_card_scans;
CREATE POLICY ehr_insurance_card_scans_select
  ON public.ehr_insurance_card_scans FOR SELECT
  TO authenticated
  USING (
    practice_id IN (
      SELECT practice_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ehr_insurance_card_scans_insert ON public.ehr_insurance_card_scans;
CREATE POLICY ehr_insurance_card_scans_insert
  ON public.ehr_insurance_card_scans FOR INSERT
  TO authenticated
  WITH CHECK (
    practice_id IN (
      SELECT practice_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ehr_insurance_card_scans_update ON public.ehr_insurance_card_scans;
CREATE POLICY ehr_insurance_card_scans_update
  ON public.ehr_insurance_card_scans FOR UPDATE
  TO authenticated
  USING (
    practice_id IN (
      SELECT practice_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ehr_insurance_card_scans_delete ON public.ehr_insurance_card_scans;
CREATE POLICY ehr_insurance_card_scans_delete
  ON public.ehr_insurance_card_scans FOR DELETE
  TO authenticated
  USING (
    practice_id IN (
      SELECT practice_id FROM public.users WHERE id = auth.uid()
    )
  );

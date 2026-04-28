-- Wave 43 / T2 — patient document upload.
--
-- Patients sometimes need to share documents that aren't part of any
-- structured form: prior treatment summaries, custody court orders,
-- accommodation letters, school IEPs, photos of paperwork they want
-- in the chart, etc. This table stores the metadata + a pointer to
-- the S3 object in the harbor-staging-patient-documents-* bucket.
--
-- Bytes live in S3 with KMS encryption + versioning + 7-year lifecycle
-- (medical-record retention). Soft delete = sets deleted_at and S3
-- DELETE creates a delete marker (versioned bucket); hard delete is
-- only via the lifecycle expiration of noncurrent versions at 2555d.

CREATE TABLE IF NOT EXISTS public.ehr_patient_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,

  s3_key          TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type    TEXT,
  size_bytes      BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),  -- 10 MB cap
  -- SHA-256 of the file contents at upload time. Populated by the API
  -- after PutObject so we can detect tampering on a future GetObject.
  sha256_hex      TEXT,

  -- Free-form taxonomy ('court_order', 'prior_treatment_record',
  -- 'iep', 'insurance_doc', 'consent_scan', 'other'). Not a CHECK so
  -- practices can extend with their own buckets without a migration.
  category        TEXT NOT NULL DEFAULT 'other',
  description     TEXT,

  uploaded_by_user_id UUID REFERENCES public.users(id)    ON DELETE SET NULL,
  uploaded_by_patient BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_patient_documents_patient
  ON public.ehr_patient_documents (practice_id, patient_id, uploaded_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_patient_documents_s3_key
  ON public.ehr_patient_documents (s3_key);

ALTER TABLE public.ehr_patient_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_documents_select ON public.ehr_patient_documents;
CREATE POLICY patient_documents_select ON public.ehr_patient_documents
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS patient_documents_insert ON public.ehr_patient_documents;
CREATE POLICY patient_documents_insert ON public.ehr_patient_documents
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS patient_documents_update ON public.ehr_patient_documents;
CREATE POLICY patient_documents_update ON public.ehr_patient_documents
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

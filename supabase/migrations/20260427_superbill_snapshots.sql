-- Wave 42 / HIPAA hardening — superbill PDF snapshots.
--
-- Background: Wave 38 / TS7 introduced the ehr_superbills snapshot table
-- (charges_snapshot_json), but the actual PDF was regenerated from live
-- charges/payments on every download. That meant the same superbill_id
-- could produce different bytes on different days as charges shifted, ERAs
-- arrived, etc. For accounting / audit / patient legal records, the issued
-- bytes must be stable.
--
-- HIPAA retention rationale:
--   * 45 CFR 164.530(j)(2): policies, procedures, and other documentation
--     must be retained for 6 years from the date of creation or last
--     effective date. Superbills are billing records the patient submits
--     to insurance and may rely on for years; we keep them 7 years (matches
--     the S3 bucket lifecycle expiry). Shorter retention is not safe.
--   * SHA-256 of the persisted PDF is recomputed on every replay and
--     compared to pdf_sha256; a mismatch blocks the download (500) and
--     fires the billing.superbill.snapshot_integrity_failure audit event.
--   * S3 versioning is enabled on the snapshot bucket so admin
--     regeneration preserves the original bytes for tamper detection.
--   * Bucket is KMS-encrypted at rest with the existing
--     alias/<name>-s3 key; access is gated by ECS task IAM only, no
--     public access, non-TLS connections denied at the bucket policy.
--   * Every snapshot lifecycle event (created, replayed, regenerated,
--     integrity_failure) writes an audit_logs row.
--
-- The columns added below are nullable so existing rows from before this
-- migration continue to work; the API route falls back to live regen when
-- pdf_s3_key IS NULL (first download seeds it), then snapshot-based
-- forever after.

ALTER TABLE public.ehr_superbills
  ADD COLUMN IF NOT EXISTS pdf_s3_key       TEXT NULL,
  ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS pdf_size_bytes   INTEGER NULL,
  ADD COLUMN IF NOT EXISTS pdf_sha256       TEXT NULL;

COMMENT ON COLUMN public.ehr_superbills.pdf_s3_key IS
  'S3 object key (within the superbill-snapshots bucket) for the immutable PDF snapshot. NULL until the first download seeds it.';
COMMENT ON COLUMN public.ehr_superbills.pdf_generated_at IS
  'When the snapshot was first persisted to S3. Updated on admin regenerate.';
COMMENT ON COLUMN public.ehr_superbills.pdf_size_bytes IS
  'Snapshot size in bytes (defensive — drift hint before SHA check).';
COMMENT ON COLUMN public.ehr_superbills.pdf_sha256 IS
  'SHA-256 hex digest of the snapshot bytes; recomputed on every replay and compared to detect tamper / corruption.';

-- Index used by the replay path: practice + patient + (from,to) is how the
-- therapist GET resolves an existing snapshot before falling back to the
-- snapshot insert. The portal route looks up by id (PK already covers it).
CREATE INDEX IF NOT EXISTS idx_ehr_superbills_practice_patient_range
  ON public.ehr_superbills (practice_id, patient_id, from_date, to_date)
  WHERE pdf_s3_key IS NOT NULL;

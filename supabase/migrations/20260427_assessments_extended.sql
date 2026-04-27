-- Wave 38 / TS5 — assessment library extension.
-- Adds support for AUDIT (10-item), DAST-10, and the NICHQ Vanderbilt
-- parent and teacher informant rating scales. CSSRS is deliberately
-- deferred to a later focused task.
--
-- The patient_assessments.assessment_type column is TEXT (no CHECK
-- constraint in production migrations), so adding new instrument IDs
-- requires no schema change. This migration:
--   1) Drops any legacy CHECK constraint that may exist on dev clones
--      seeded from infra/sql/schema.sql.
--   2) Adds an optional `subscale_scores JSONB` column for instruments
--      whose clinical interpretation is per-subscale rather than a
--      single total (Vanderbilt parent/teacher).
--   3) Backfills nothing — legacy rows are still valid.

-- 1) Drop legacy CHECK constraint if present (defensive — it isn't in
-- the prod migration tree, but dev DBs cloned from schema.sql may have it).
DO $$
DECLARE
  cn TEXT;
BEGIN
  SELECT conname INTO cn
    FROM pg_constraint
   WHERE conrelid = 'public.patient_assessments'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%assessment_type%';
  IF cn IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.patient_assessments DROP CONSTRAINT %I', cn);
    RAISE NOTICE 'Dropped legacy assessment_type CHECK constraint: %', cn;
  END IF;
END$$;

-- 2) Subscale scores for multi-dimensional instruments.
ALTER TABLE public.patient_assessments
  ADD COLUMN IF NOT EXISTS subscale_scores JSONB;

COMMENT ON COLUMN public.patient_assessments.subscale_scores IS
  'Optional per-subscale scoring (e.g., Vanderbilt: { inattentive: 8, hyperactive: 6, '
  'odd: 3, conduct: 0, anxiety_depression: 2 }). NULL for single-score instruments.';

-- 3) Index helps the trajectory chart render only completed scores.
CREATE INDEX IF NOT EXISTS idx_patient_assessments_completed
  ON public.patient_assessments (patient_id, assessment_type, completed_at DESC)
  WHERE status = 'completed';

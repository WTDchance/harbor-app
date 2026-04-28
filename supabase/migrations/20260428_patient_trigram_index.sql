-- Wave 44 / T4 — pg_trgm index for patient duplicate detection.
--
-- The new POST /api/ehr/patients/duplicate-check route runs a
-- similarity() filter on first_name || ' ' || last_name to flag
-- name-similar candidates with matching DOBs. Without a GIN trigram
-- index this is a sequential scan; with the index it stays sub-100ms
-- on practices with tens of thousands of patients.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_patients_name_trgm
  ON public.patients
  USING gin (lower(first_name || ' ' || last_name) gin_trgm_ops);

COMMENT ON INDEX public.idx_patients_name_trgm IS
  'GIN trigram index on lower(first_name || '' '' || last_name). '
  'Powers POST /api/ehr/patients/duplicate-check (W44 T4) and '
  'similar fuzzy patient search uses.';

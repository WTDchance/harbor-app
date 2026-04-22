-- AI-generated patient summary cache.
-- Populated by /api/ehr/patients/[id]/summary (Claude Sonnet reads call
-- logs + intake + assessments + signed notes + mood logs and writes a
-- short "who is this patient" snapshot the therapist can read in 15s
-- before walking into session).

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS ai_summary TEXT,
  ADD COLUMN IF NOT EXISTS ai_summary_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_summary_model TEXT;

COMMENT ON COLUMN public.patients.ai_summary IS
  'Sonnet-generated 3-5 sentence patient snapshot. Cached so repeat '
  'visits to the profile do not re-charge the API. Regenerate button '
  'invalidates and rewrites.';

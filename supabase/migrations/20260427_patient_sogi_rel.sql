-- Wave 40 / P4 — Patient demographics (SOGI / REL).
--
-- Joint Commission, CMS, and many state Medicaids require collection
-- of race, ethnicity, primary language, sexual orientation, and gender
-- identity. Harbor previously had pronouns only.
--
-- All fields are nullable + self-declared. UCSF Center for Excellence
-- in Sexual Health Equity guidance:
--   https://transcare.ucsf.edu/guidelines/data-collection
--
-- HARD RULE: these fields MUST NOT be used for AI prompting,
-- clinical decision support, or any inference. They are self-declared
-- identity; full stop. No code path that calls into Bedrock /
-- Anthropic / lib/aws/llm.ts may read these columns.

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS race                  TEXT[],
  ADD COLUMN IF NOT EXISTS ethnicity             TEXT[],
  ADD COLUMN IF NOT EXISTS primary_language      TEXT,
  ADD COLUMN IF NOT EXISTS sexual_orientation    TEXT,
  ADD COLUMN IF NOT EXISTS gender_identity       TEXT,
  ADD COLUMN IF NOT EXISTS pronouns_self_describe TEXT;

COMMENT ON COLUMN public.patients.race IS
  'Self-declared race(s) — arrays so a patient can identify with multiple. '
  'Reference: UCSF Center for Excellence in Sexual Health Equity. '
  'NEVER read from any AI/LLM call path.';
COMMENT ON COLUMN public.patients.ethnicity IS
  'Self-declared ethnicity. NEVER read from any AI/LLM call path.';
COMMENT ON COLUMN public.patients.primary_language IS
  'Self-declared primary language for clinical communication. '
  'NEVER read from any AI/LLM call path.';
COMMENT ON COLUMN public.patients.sexual_orientation IS
  'Self-declared sexual orientation. UCSF SOGI two-step. '
  'NEVER read from any AI/LLM call path.';
COMMENT ON COLUMN public.patients.gender_identity IS
  'Self-declared gender identity. UCSF SOGI two-step. '
  'NEVER read from any AI/LLM call path.';
COMMENT ON COLUMN public.patients.pronouns_self_describe IS
  'Free-text pronouns when the picker (he/she/they) does not capture '
  'the patient''s preference. NEVER read from any AI/LLM call path.';

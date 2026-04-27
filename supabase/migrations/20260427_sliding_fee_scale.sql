-- Wave 41 / T6 — Sliding fee scale.
--
-- Common in mental-health practices, especially community / training
-- programs: discount the CPT base fee per a tier the patient is
-- assigned to, based on documented income or hardship.
--
-- Practice-side config: an array of tiers, each with a name, an
-- income threshold, and a fee_pct (percent of base fee the patient
-- pays). Patient-side: a free-text fee_tier label that matches one
-- of the configured tiers.
--
-- All additive + idempotent.

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS sliding_fee_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sliding_fee_config  JSONB   NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.practices.sliding_fee_enabled IS
  'When TRUE, charges generated for patients with a matching fee_tier '
  'are discounted per sliding_fee_config. Off by default.';
COMMENT ON COLUMN public.practices.sliding_fee_config IS
  'Array of { name, income_threshold_cents, fee_pct } objects. fee_pct '
  'is the percentage of the base CPT fee the patient pays (e.g. 50 means '
  'half-off). The first matching tier (by name) wins.';

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS fee_tier TEXT;

COMMENT ON COLUMN public.patients.fee_tier IS
  'Sliding-fee tier name assigned to this patient. NULL means full fee. '
  'Must match a tier name in practices.sliding_fee_config or the discount '
  'is silently skipped (and a console.warn fires from the helper).';

CREATE INDEX IF NOT EXISTS idx_patients_fee_tier
  ON public.patients (practice_id, fee_tier)
  WHERE fee_tier IS NOT NULL;

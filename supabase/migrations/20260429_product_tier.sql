-- Wave 48 / T1 — product tier flag.
--
-- Harbor today is one product (EHR + AI receptionist). This flag
-- introduces four tiers so a practice can be:
--   ehr_full        — today's product (default for existing practices)
--   reception_only  — Harbor's AI receptionist only; their EHR is
--                     somewhere else (Ensora, SimplePractice, etc.)
--   ehr_only        — full EHR, they provide their own reception
--   both            — explicit dual
--
-- Existing rows pick up the default 'ehr_full' so this migration is a
-- no-op behavior change on its own. Tier-aware routing lands in T6.

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS product_tier TEXT NOT NULL
    DEFAULT 'ehr_full'
    CHECK (product_tier IN ('ehr_full','reception_only','ehr_only','both'));

CREATE INDEX IF NOT EXISTS idx_practices_product_tier
  ON public.practices (product_tier);

COMMENT ON COLUMN public.practices.product_tier IS
  'Which Harbor product surface this practice has access to. '
  'ehr_full = today''s EHR + receptionist (default). '
  'reception_only = AI receptionist only (their EHR is elsewhere). '
  'ehr_only = EHR only (they have their own reception). '
  'both = explicit dual. Tier-aware route guards live in '
  'lib/aws/api-auth::requireProductTier (W48 T6).';

-- Wave 47 — Reception product split.
--
-- Introduces a product_tier flag on practices so a single practice row can
-- model four product modes:
--   ehr_full        existing Harbor product (EHR + AI receptionist)
--   reception_only  AI receptionist only — practice's EHR lives elsewhere
--   ehr_only        full EHR but the practice runs their own phone reception
--   both            both products explicitly enabled
--
-- All existing rows default to 'ehr_full' so nothing changes for current
-- customers. New reception-only signups land in 'reception_only'.

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS product_tier TEXT NOT NULL DEFAULT 'ehr_full'
    CHECK (product_tier IN ('ehr_full','reception_only','ehr_only','both'));

CREATE INDEX IF NOT EXISTS idx_practices_product_tier
  ON practices(product_tier);

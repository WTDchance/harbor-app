-- Wave 42 / T2 — practice settings polish.
--
-- Three additive changes:
--   1. practices.ai_prompt_override TEXT — per-practice override of
--      the Retell LLM's general_prompt. NULL = keep the demo-cloned
--      prompt (pre-baked fallbacks from cloneAgentForPractice).
--      Non-null is pushed to the practice's LLM via Retell's
--      update-retell-llm API on save.
--   2. ehr_practice_locations — multi-location support. Practices
--      with one location can ignore this; the existing
--      practices.address_line1 etc. stays as the primary location.
--   3. Audit hooks (no schema, just enum addition).

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS ai_prompt_override TEXT;

COMMENT ON COLUMN public.practices.ai_prompt_override IS
  'Per-practice override of the Retell LLM general_prompt. NULL = keep '
  'the cloneAgentForPractice baseline. Non-null is pushed to the '
  'practice''s LLM at save time. The {{practice_name}} / '
  '{{therapist_name}} placeholders remain valid even in overrides — '
  'Retell substitutes them per-call from inbound webhook context.';

CREATE TABLE IF NOT EXISTS public.ehr_practice_locations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  name                     TEXT NOT NULL,
  address_line1            TEXT,
  address_line2            TEXT,
  city                     TEXT,
  state                    TEXT,
  zip                      TEXT,
  phone                    TEXT,

  -- Per-location preference for which session types the location
  -- supports. 'both' = either telehealth or in-person at this address.
  modality_preference      TEXT NOT NULL DEFAULT 'both'
                             CHECK (modality_preference IN ('in_person','telehealth','both')),

  is_primary               BOOLEAN NOT NULL DEFAULT FALSE,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ehr_practice_locations IS
  'Multi-location support for practices that operate at more than one '
  'address. The existing practices.address_line1 etc. remain as the '
  'primary location; rows here represent additional or alternative '
  'locations. is_primary=TRUE marks the row that mirrors the main '
  'practice address.';

CREATE INDEX IF NOT EXISTS idx_practice_locations_practice
  ON public.ehr_practice_locations (practice_id, is_active);
-- Only one primary per practice (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_practice_locations_one_primary
  ON public.ehr_practice_locations (practice_id)
  WHERE is_primary = TRUE;

CREATE OR REPLACE FUNCTION public.practice_locations_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_practice_locations_touch ON public.ehr_practice_locations;
CREATE TRIGGER trg_practice_locations_touch
  BEFORE UPDATE ON public.ehr_practice_locations
  FOR EACH ROW EXECUTE FUNCTION public.practice_locations_touch();

ALTER TABLE public.ehr_practice_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_locations_select ON public.ehr_practice_locations;
CREATE POLICY practice_locations_select ON public.ehr_practice_locations
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS practice_locations_insert ON public.ehr_practice_locations;
CREATE POLICY practice_locations_insert ON public.ehr_practice_locations
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS practice_locations_update ON public.ehr_practice_locations;
CREATE POLICY practice_locations_update ON public.ehr_practice_locations
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS practice_locations_delete ON public.ehr_practice_locations;
CREATE POLICY practice_locations_delete ON public.ehr_practice_locations
  FOR DELETE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

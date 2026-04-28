-- Wave 47 / T5 — saved patient-list views + bulk action audit.
--
-- Therapists save the current filter set as a named view, recall it
-- later from a dropdown. Each view stores filters + sort as JSONB so
-- the filter UI can extend without a schema change.
--
-- Sharing: is_shared_with_practice=true makes a view visible to
-- everyone in the practice (read-only on others' views; only the
-- owner edits/deletes).

CREATE TABLE IF NOT EXISTS public.ehr_saved_patient_views (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  owner_user_id   UUID NOT NULL REFERENCES public.users(id)     ON DELETE CASCADE,

  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),

  -- Filters: free-form JSONB. Common keys: q (text search), status,
  -- therapist_id, has_flag_color, has_unsigned_notes, last_seen_within,
  -- engagement_lt, etc. Schema-light by design — patient list page
  -- decides what's meaningful at render time.
  filters         JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Sort: { column: 'last_name'|'created_at'|..., direction: 'asc'|'desc' }
  sort            JSONB NOT NULL DEFAULT '{}'::jsonb,

  is_shared_with_practice BOOLEAN NOT NULL DEFAULT FALSE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Names are unique per owner so the dropdown stays clean.
  UNIQUE (owner_user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_views_owner
  ON public.ehr_saved_patient_views (owner_user_id, name);
CREATE INDEX IF NOT EXISTS idx_saved_views_practice_shared
  ON public.ehr_saved_patient_views (practice_id, is_shared_with_practice)
  WHERE is_shared_with_practice = TRUE;

CREATE OR REPLACE FUNCTION public.ehr_saved_views_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_saved_views_touch ON public.ehr_saved_patient_views;
CREATE TRIGGER trg_saved_views_touch
  BEFORE UPDATE ON public.ehr_saved_patient_views
  FOR EACH ROW
  EXECUTE FUNCTION public.ehr_saved_views_touch();

ALTER TABLE public.ehr_saved_patient_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saved_views_select ON public.ehr_saved_patient_views;
CREATE POLICY saved_views_select ON public.ehr_saved_patient_views
  FOR SELECT TO authenticated
  USING (
    practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid())
    AND (owner_user_id = auth.uid() OR is_shared_with_practice = TRUE)
  );

DROP POLICY IF EXISTS saved_views_modify ON public.ehr_saved_patient_views;
CREATE POLICY saved_views_modify ON public.ehr_saved_patient_views
  FOR ALL TO authenticated
  USING      (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid()
              AND practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

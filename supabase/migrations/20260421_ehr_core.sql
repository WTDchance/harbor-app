-- ============================================================
-- Harbor EHR — core schema bootstrap
--
-- First migration on feature/ehr-v0. Adds the per-practice
-- feature flag and the progress-notes table. Everything under
-- the ehr_* prefix so the whole module can be dropped cleanly
-- if we ever need to roll back.
-- ============================================================

-- ----- Feature flag on practices --------------------------------------------

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS ehr_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.practices.ehr_enabled IS
  'When true, the EHR module (progress notes, treatment plans, claims) is '
  'visible and operable for this practice. Default false so existing '
  'practices see zero new surface area until explicitly opted in.';

-- ----- ehr_progress_notes ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ehr_progress_notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id      UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  appointment_id   UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  therapist_id     UUID REFERENCES public.therapists(id)   ON DELETE SET NULL,

  title            TEXT NOT NULL,
  note_format      TEXT NOT NULL DEFAULT 'soap'
                      CHECK (note_format IN ('soap', 'dap', 'birp', 'freeform')),

  -- SOAP / DAP / BIRP structured sections. Any subset may be populated
  -- depending on note_format. For 'freeform', only body is used.
  subjective       TEXT,
  objective        TEXT,
  assessment       TEXT,
  plan             TEXT,
  body             TEXT,

  -- Billing codes (simple array form for now; richer model when we wire claims)
  cpt_codes        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  icd10_codes      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Lifecycle
  status           TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'signed', 'amended', 'deleted')),
  signed_at        TIMESTAMPTZ,
  signed_by        UUID, -- auth.users(id) — no FK so auth schema stays decoupled
  signature_hash   TEXT, -- SHA-256 of signed content; tamper check

  -- Audit fields
  created_by       UUID, -- auth.users(id)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ehr_progress_notes IS
  'Clinical progress notes per Harbor EHR. One row per note. '
  'Signed notes are immutable — further edits create an amended row '
  'that links back via an amendment_of column added in a later migration.';

-- ----- Indexes --------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_ehr_notes_practice_patient
  ON public.ehr_progress_notes (practice_id, patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ehr_notes_practice_status
  ON public.ehr_progress_notes (practice_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ehr_notes_appointment
  ON public.ehr_progress_notes (appointment_id)
  WHERE appointment_id IS NOT NULL;

-- ----- updated_at trigger ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.ehr_progress_notes_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_progress_notes_touch_updated_at
  ON public.ehr_progress_notes;

CREATE TRIGGER trg_ehr_progress_notes_touch_updated_at
  BEFORE UPDATE ON public.ehr_progress_notes
  FOR EACH ROW EXECUTE FUNCTION public.ehr_progress_notes_touch_updated_at();

-- ----- Row Level Security ---------------------------------------------------

ALTER TABLE public.ehr_progress_notes ENABLE ROW LEVEL SECURITY;

-- Mirror the therapists-table policy shape: practice members can read/write
-- notes for their practice; service role bypasses for server-side inserts.

DROP POLICY IF EXISTS ehr_notes_select ON public.ehr_progress_notes;
CREATE POLICY ehr_notes_select
  ON public.ehr_progress_notes FOR SELECT
  TO authenticated
  USING (
    practice_id IN (
      SELECT practice_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ehr_notes_insert ON public.ehr_progress_notes;
CREATE POLICY ehr_notes_insert
  ON public.ehr_progress_notes FOR INSERT
  TO authenticated
  WITH CHECK (
    practice_id IN (
      SELECT practice_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ehr_notes_update ON public.ehr_progress_notes;
CREATE POLICY ehr_notes_update
  ON public.ehr_progress_notes FOR UPDATE
  TO authenticated
  USING (
    practice_id IN (
      SELECT practice_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ehr_notes_delete ON public.ehr_progress_notes;
CREATE POLICY ehr_notes_delete
  ON public.ehr_progress_notes FOR DELETE
  TO authenticated
  USING (
    practice_id IN (
      SELECT practice_id FROM public.users WHERE id = auth.uid()
    )
  );

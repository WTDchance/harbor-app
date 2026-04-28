-- Wave 46 / T2 — group therapy management depth.
--
-- W38 ehr_group_sessions + ehr_group_participants handle closed-roster
-- groups but the workflow is shallow. This migration adds:
--   * Per-attendee timing detail on ehr_group_participants
--   * A way to bind a single ehr_progress_notes row to a group session
--     (the note's main body = shared session narrative; per-member
--     individual observations live in W41 ehr_progress_note_patients
--     per-attendee.)
--   * Group treatment plans — a single plan binding the group's
--     collective work alongside per-member ehr_treatment_plans rows.
--   * Per-member CPT 90853 billing — keyed via the existing
--     ehr_charges table with note_id pointing at the group note,
--     so no new columns are needed beyond a comment guideline.

-- 1. Per-attendee timing on ehr_group_participants.
ALTER TABLE public.ehr_group_participants
  ADD COLUMN IF NOT EXISTS late_arrival_minutes   INTEGER,
  ADD COLUMN IF NOT EXISTS early_departure_minutes INTEGER;
COMMENT ON COLUMN public.ehr_group_participants.late_arrival_minutes IS
  'Minutes the patient arrived after group start. NULL = on time or '
  'absent. attendance=''late'' should imply this is non-NULL.';
COMMENT ON COLUMN public.ehr_group_participants.early_departure_minutes IS
  'Minutes the patient departed before group end. NULL = stayed full '
  'session or absent.';

-- 2. Link a progress note to a group session.
-- A single shared note covers the session's overall content; the
-- per-attendee individual sections live in
-- ehr_progress_note_patients (W41) which already covers this shape.
ALTER TABLE public.ehr_progress_notes
  ADD COLUMN IF NOT EXISTS group_session_id UUID
    REFERENCES public.ehr_group_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_progress_notes_group_session
  ON public.ehr_progress_notes (group_session_id)
  WHERE group_session_id IS NOT NULL;

COMMENT ON COLUMN public.ehr_progress_notes.group_session_id IS
  'Set when this note is the shared session note for a group. The '
  'note''s main body holds the group narrative; per-member observations '
  'live in ehr_progress_note_patients (W41 multi-patient pattern). '
  'patient_id on the note row is the group facilitator''s primary '
  'patient or NULL — the per-member rows are authoritative.';

-- 3. Group treatment plans.
CREATE TABLE IF NOT EXISTS public.ehr_group_treatment_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id      UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  -- A treatment plan is per-group (not per-session). The group is
  -- identified via the ehr_group_sessions.title or group_type today;
  -- a future migration may introduce ehr_groups as a parent table.
  -- Until then, group_session_id pins the plan to a specific session
  -- as the canonical rendering point — but every session of the same
  -- group should reference the same plan for continuity. The unique
  -- index below enforces "at most one active plan per group_session".
  group_session_id UUID NOT NULL REFERENCES public.ehr_group_sessions(id) ON DELETE CASCADE,

  title            TEXT NOT NULL DEFAULT 'Group treatment plan',
  presenting_problem TEXT,
  -- Same JSONB shape as ehr_treatment_plans.goals so the existing
  -- treatment-plan UI can render group plans without changes.
  goals            JSONB NOT NULL DEFAULT '[]'::JSONB,
  frequency        TEXT,

  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('draft', 'active', 'revised', 'completed', 'archived')),
  start_date       DATE DEFAULT CURRENT_DATE,
  review_date      DATE,
  signed_at        TIMESTAMPTZ,
  signed_by        UUID,

  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_treatment_plans_session
  ON public.ehr_group_treatment_plans (practice_id, group_session_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_group_treatment_plans_active_per_session
  ON public.ehr_group_treatment_plans (group_session_id)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.ehr_group_treatment_plans_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_group_treatment_plans_touch ON public.ehr_group_treatment_plans;
CREATE TRIGGER trg_group_treatment_plans_touch
  BEFORE UPDATE ON public.ehr_group_treatment_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.ehr_group_treatment_plans_touch();

ALTER TABLE public.ehr_group_treatment_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS group_treatment_plans_all ON public.ehr_group_treatment_plans;
CREATE POLICY group_treatment_plans_all ON public.ehr_group_treatment_plans
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

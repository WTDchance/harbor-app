-- Wave 46 / T3 — clinical task list per patient + per therapist.
--
-- Therapist-specific reminder system. Two surfaces:
--   * Per-patient: "Tasks" tab on patient detail. Notes the
--     therapist wants to remember next session ("Ask about her
--     divorce in 2 weeks", "Follow up on med review", "Send Aetna
--     pre-auth packet by Friday").
--   * Per-therapist: Today screen widget showing tasks due today /
--     this week. Quick-complete (tap done), reschedule, reassign.
--
-- Practice-scoped RLS plus assignee scope at the API layer (a
-- supervisor sees their own assignments + their supervisees'; a
-- regular therapist sees their own only).

CREATE TABLE IF NOT EXISTS public.ehr_clinical_tasks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id          UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  -- Owner: who is responsible for completing this. Required.
  assigned_to_user_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,

  -- Optional patient context. NULL for purely admin/billing/supervision
  -- tasks not tied to a patient.
  patient_id           UUID REFERENCES public.patients(id) ON DELETE SET NULL,

  title                TEXT NOT NULL,
  description          TEXT,

  -- Optional due date. Tasks without a due_at sit in a backlog.
  due_at               TIMESTAMPTZ,

  -- Lifecycle.
  completed_at         TIMESTAMPTZ,
  completed_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Categorization for filtering + the Today widget.
  kind                 TEXT NOT NULL DEFAULT 'clinical_followup'
                         CHECK (kind IN (
                           'patient_reminder',
                           'clinical_followup',
                           'admin',
                           'supervision',
                           'billing'
                         )),

  priority             TEXT NOT NULL DEFAULT 'normal'
                         CHECK (priority IN ('low', 'normal', 'high')),

  created_by_user_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinical_tasks_assignee_due
  ON public.ehr_clinical_tasks (practice_id, assigned_to_user_id, due_at NULLS LAST)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_clinical_tasks_patient
  ON public.ehr_clinical_tasks (practice_id, patient_id, created_at DESC)
  WHERE patient_id IS NOT NULL AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_clinical_tasks_practice_recent
  ON public.ehr_clinical_tasks (practice_id, completed_at DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.ehr_clinical_tasks_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_clinical_tasks_updated_at ON public.ehr_clinical_tasks;
CREATE TRIGGER trg_ehr_clinical_tasks_updated_at
  BEFORE UPDATE ON public.ehr_clinical_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.ehr_clinical_tasks_touch_updated_at();

ALTER TABLE public.ehr_clinical_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinical_tasks_all ON public.ehr_clinical_tasks;
CREATE POLICY clinical_tasks_all ON public.ehr_clinical_tasks
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

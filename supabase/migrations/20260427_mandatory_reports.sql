-- Wave 39 / Task 4 — Mandatory reporter workflow.
--
-- Therapists are mandated reporters in every state. This table records
-- the trail when a clinician reports suspected child / elder / dependent
-- adult abuse, files a Tarasoff warning, or documents imminent danger.
-- HIGH-SENSITIVITY data — every read/write is auditable and supervisor
-- emails are sent on draft creation (non-PHI heads-up only).

CREATE TABLE IF NOT EXISTS public.ehr_mandatory_reports (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id               UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  reporter_user_id         UUID NOT NULL REFERENCES public.users(id)     ON DELETE RESTRICT,

  report_type              TEXT NOT NULL
                             CHECK (report_type IN (
                               'child_abuse',
                               'elder_abuse',
                               'adult_dependent_abuse',
                               'tarasoff_warning',
                               'danger_to_self',
                               'other'
                             )),
  disclosure_date          TIMESTAMPTZ NOT NULL,
  assessment_notes         TEXT NOT NULL,

  -- Filing details (set when status -> 'filed').
  agency_contacted         TEXT,
  agency_phone             TEXT,
  report_filed_at          TIMESTAMPTZ,
  report_reference_number  TEXT,

  -- Tarasoff-specific.
  intended_target_warned   BOOLEAN,
  target_warning_method    TEXT,

  outcome_notes            TEXT,

  -- Supervisor heads-up trail.
  supervisor_notified_at   TIMESTAMPTZ,
  supervisor_user_id       UUID REFERENCES public.users(id) ON DELETE SET NULL,

  status                   TEXT NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'filed', 'closed')),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ehr_mandatory_reports IS
  'Mandatory reporter trail. Clinician fills in the assessment, contacts '
  'the agency themselves (we never auto-file), records what they did. '
  'Status: draft -> filed -> closed.';

CREATE INDEX IF NOT EXISTS idx_mr_patient
  ON public.ehr_mandatory_reports (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mr_practice_status
  ON public.ehr_mandatory_reports (practice_id, status);
CREATE INDEX IF NOT EXISTS idx_mr_supervisor_pending
  ON public.ehr_mandatory_reports (supervisor_user_id, status)
  WHERE supervisor_user_id IS NOT NULL AND status <> 'closed';

CREATE OR REPLACE FUNCTION public.mr_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_mr_touch ON public.ehr_mandatory_reports;
CREATE TRIGGER trg_mr_touch
  BEFORE UPDATE ON public.ehr_mandatory_reports
  FOR EACH ROW EXECUTE FUNCTION public.mr_touch();

ALTER TABLE public.ehr_mandatory_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mr_select ON public.ehr_mandatory_reports;
CREATE POLICY mr_select ON public.ehr_mandatory_reports
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS mr_insert ON public.ehr_mandatory_reports;
CREATE POLICY mr_insert ON public.ehr_mandatory_reports
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS mr_update ON public.ehr_mandatory_reports;
CREATE POLICY mr_update ON public.ehr_mandatory_reports
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

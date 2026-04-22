-- Assessment enhancements for patient self-administration + risk flags.
-- Extends patient_assessments (don't fork the table — one source of truth).

ALTER TABLE public.patient_assessments
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending','completed','expired','abandoned'));

ALTER TABLE public.patient_assessments
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_by UUID,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS administered_via TEXT
    CHECK (administered_via IN ('therapist_in_session','portal','sms','intake_call','import')),
  ADD COLUMN IF NOT EXISTS alerts_triggered JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS interpretation TEXT,
  ADD COLUMN IF NOT EXISTS interpretation_generated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.patient_assessments.status IS
  'completed = score is real; pending = assigned to patient, awaiting response; '
  'expired = assigned but the window closed; abandoned = patient started and quit.';

COMMENT ON COLUMN public.patient_assessments.alerts_triggered IS
  'Array of { type, severity, message } objects surfaced from scoring logic '
  '(e.g. PHQ-9 Q9 positive => type="suicidal_ideation").';

CREATE INDEX IF NOT EXISTS idx_patient_assessments_status
  ON public.patient_assessments (patient_id, status, created_at DESC);

-- Score column was INTEGER; some instruments (PHQ-9 etc.) are integer
-- but allow NULL for pending rows. Relax NOT NULL if it was set.
-- Existing column definition already allows NULL in our schema, so no
-- change needed here.

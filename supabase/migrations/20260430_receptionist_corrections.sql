-- Wave 50 / D5 — practice owner corrections feed back into a labelled
-- training set. Append-only.

CREATE TABLE IF NOT EXISTS public.receptionist_corrections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id         UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  call_id             UUID NOT NULL REFERENCES public.call_logs(id) ON DELETE CASCADE,

  -- Which captured field was edited.
  field_name          TEXT NOT NULL CHECK (field_name IN (
                        'patient_name', 'patient_dob', 'patient_phone',
                        'patient_email', 'insurance_carrier', 'insurance_member_id',
                        'reason_for_call', 'urgency', 'patient_match_id', 'outcome'
                      )),
  original_value      TEXT,
  corrected_value     TEXT,
  corrected_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  corrected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receptionist_corrections_call
  ON public.receptionist_corrections (practice_id, call_id, corrected_at DESC);

CREATE INDEX IF NOT EXISTS idx_receptionist_corrections_field
  ON public.receptionist_corrections (practice_id, field_name, corrected_at DESC);

ALTER TABLE public.receptionist_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receptionist_corrections_all ON public.receptionist_corrections;
CREATE POLICY receptionist_corrections_all ON public.receptionist_corrections
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.receptionist_corrections IS
  'W50 D5 — practice-owner edits to the AI receptionist''s captured-data panel. '
  'Used as a labelled training set + audit trail for capture accuracy.';

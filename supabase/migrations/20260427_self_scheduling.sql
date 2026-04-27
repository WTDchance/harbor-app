-- Wave 42 / T1 — patient self-scheduling configuration.
--
-- Adds a per-practice scheduling_config JSONB so practices can
-- gate the public scheduling page. Existing infra (ehr_scheduling_
-- requests + /api/portal/scheduling + /api/ehr/scheduling-requests)
-- already covers patient-requested + therapist-responded flow;
-- this migration adds the config the new self-scheduling page reads.

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS scheduling_config JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.practices.scheduling_config IS
  'Configuration for the patient self-scheduling surface. Shape: '
  '{ enabled: bool, visit_types: [{key,label,duration_minutes,modality}], '
  '  default_duration_minutes: int, buffer_minutes: int, '
  '  lead_time_minutes: int, advance_window_days: int, '
  '  allow_existing_patient_direct_book: bool, '
  '  allow_new_patient_inquiry: bool, intake_visit_type_key: string }. '
  'Empty object = self-scheduling off.';

-- New-patient inquiry table — for the public /schedule/<slug> path.
-- Existing patients use ehr_scheduling_requests (which has patient_id NOT NULL).
CREATE TABLE IF NOT EXISTS public.ehr_new_patient_inquiries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  inquirer_name   TEXT NOT NULL,
  inquirer_email  TEXT,
  inquirer_phone  TEXT,
  reason          TEXT,                                         -- free-form
  preferred_windows JSONB,                                       -- same shape as ehr_scheduling_requests
  visit_type_key  TEXT,                                          -- references scheduling_config.visit_types[].key

  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','contacted','converted','declined')),
  converted_patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  responded_at    TIMESTAMPTZ,
  responded_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  notes           TEXT,

  source_ip       INET,                                          -- abuse forensics
  source_user_agent TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ehr_new_patient_inquiries IS
  'Public-facing new-patient inquiry submitted from /schedule/<slug>. '
  'Distinct from ehr_scheduling_requests which is for existing patients.';

CREATE INDEX IF NOT EXISTS idx_new_patient_inquiries_practice_status
  ON public.ehr_new_patient_inquiries (practice_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.new_patient_inquiries_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_new_patient_inquiries_touch ON public.ehr_new_patient_inquiries;
CREATE TRIGGER trg_new_patient_inquiries_touch
  BEFORE UPDATE ON public.ehr_new_patient_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.new_patient_inquiries_touch();

ALTER TABLE public.ehr_new_patient_inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS new_patient_inquiries_select ON public.ehr_new_patient_inquiries;
CREATE POLICY new_patient_inquiries_select ON public.ehr_new_patient_inquiries
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS new_patient_inquiries_update ON public.ehr_new_patient_inquiries;
CREATE POLICY new_patient_inquiries_update ON public.ehr_new_patient_inquiries
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
-- INSERT policy intentionally omitted — public route uses
-- supabaseAdmin (service role) to bypass RLS for unauthenticated
-- writes.

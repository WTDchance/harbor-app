-- Wave 50 / D6 — patient-scoped insurance verification snapshots used
-- by the in-network onramp UI. The legacy eligibility_checks table is
-- insurance_record-scoped and stays in place; this is a thin wrapper
-- that gives the patient detail page a clean per-patient verification
-- history with parsed_summary + expires_at.

CREATE TABLE IF NOT EXISTS public.ehr_insurance_verifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id           UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,

  payer_id              TEXT,
  payer_name            TEXT,
  member_id             TEXT,
  group_number          TEXT,
  plan_name             TEXT,

  -- Lifecycle: pending while we wait on the 271 response, completed on
  -- success, errored if the upstream 271 failed.
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'completed', 'errored')),

  raw_request           JSONB,
  raw_response          JSONB,

  -- Parsed flat shape rendered in the UI.
  -- {
  --   covered_services: ['90834','90837','90791','90847', ...],
  --   copay_cents: int|null,
  --   deductible_total_cents: int|null,
  --   deductible_met_cents: int|null,
  --   out_of_pocket_max_cents: int|null,
  --   out_of_pocket_met_cents: int|null,
  --   prior_auth_required: bool|null,
  --   plan_active: bool|null,
  --   member_id_valid: bool|null,
  -- }
  parsed_summary        JSONB NOT NULL DEFAULT '{}'::jsonb,

  requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,

  -- Stedi 271 typically considers eligibility good for 30 days.
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),

  requested_by_user_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  source                TEXT NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('manual', 'auto_textract', 'cron_refresh')),

  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_insurance_verifications_patient
  ON public.ehr_insurance_verifications (practice_id, patient_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_ehr_insurance_verifications_active
  ON public.ehr_insurance_verifications (practice_id, patient_id, expires_at DESC)
  WHERE status = 'completed';

CREATE OR REPLACE FUNCTION public.ehr_insurance_verifications_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_insurance_verifications_updated_at ON public.ehr_insurance_verifications;
CREATE TRIGGER trg_ehr_insurance_verifications_updated_at
  BEFORE UPDATE ON public.ehr_insurance_verifications
  FOR EACH ROW EXECUTE FUNCTION public.ehr_insurance_verifications_touch();

ALTER TABLE public.ehr_insurance_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_insurance_verifications_all ON public.ehr_insurance_verifications;
CREATE POLICY ehr_insurance_verifications_all ON public.ehr_insurance_verifications
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.ehr_insurance_verifications IS
  'W50 D6 — per-patient Stedi 270/271 verification snapshot with parsed_summary. '
  'Wrapper over eligibility_checks; rendered in the patient-detail Insurance tab.';

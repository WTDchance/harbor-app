-- Wave 52 / D4 — ERA remittance + claim payment auto-match.
--
-- Distinct from the W41 ehr_era_files / ehr_era_claim_payments tables
-- (those are still the source of truth for the original Stedi 835 ingest;
-- this is the W52 reconciliation layer with auto-match status, dispute
-- flow, and reusable matching against the higher-level claims/charges
-- tables that downstream billing UI uses). Both can coexist; the new
-- /api/webhooks/stedi-835 writes to era_remittances; existing 835 cron
-- continues writing to the legacy table.

CREATE TABLE IF NOT EXISTS public.era_remittances (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  payer_name               TEXT,
  payer_id                 TEXT,
  check_or_eft_number      TEXT,
  payment_amount_cents     INT NOT NULL,
  payment_date             DATE,

  raw_835_payload          JSONB NOT NULL,
  parsed_summary           JSONB,

  status                   TEXT NOT NULL DEFAULT 'unmatched'
                             CHECK (status IN ('unmatched','partially_matched','fully_matched','disputed')),

  received_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_era_remittances_practice_status
  ON public.era_remittances (practice_id, status, received_at DESC);

CREATE OR REPLACE FUNCTION public.era_remittances_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_era_remittances_updated_at ON public.era_remittances;
CREATE TRIGGER trg_era_remittances_updated_at
  BEFORE UPDATE ON public.era_remittances
  FOR EACH ROW EXECUTE FUNCTION public.era_remittances_touch();

ALTER TABLE public.era_remittances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS era_remittances_all ON public.era_remittances;
CREATE POLICY era_remittances_all ON public.era_remittances
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));


CREATE TABLE IF NOT EXISTS public.era_claim_payments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  era_id                   UUID NOT NULL REFERENCES public.era_remittances(id) ON DELETE CASCADE,
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  -- The W52 spec references claims / charges; Harbor's higher-level
  -- billing tables are ehr_invoices + ehr_charges. We accept either
  -- by storing both refs (nullable) so future auto-match passes can
  -- target whichever shape is present.
  claim_id                 UUID,
  patient_id               UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  appointment_id           UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  charge_id                UUID,
  invoice_id               UUID,

  service_date             DATE,
  cpt_code                 TEXT,
  billed_amount_cents      INT,
  allowed_amount_cents     INT,
  paid_amount_cents        INT,
  patient_responsibility_cents INT,
  adjustment_codes         JSONB NOT NULL DEFAULT '[]'::jsonb,

  match_method             TEXT CHECK (match_method IS NULL OR match_method IN ('auto','manual','disputed')),
  matched_at               TIMESTAMPTZ,
  matched_by_user_id       UUID REFERENCES public.users(id) ON DELETE SET NULL,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_era_claim_payments_era
  ON public.era_claim_payments (era_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_era_claim_payments_practice_unmatched
  ON public.era_claim_payments (practice_id, created_at DESC)
  WHERE matched_at IS NULL;

ALTER TABLE public.era_claim_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS era_claim_payments_all ON public.era_claim_payments;
CREATE POLICY era_claim_payments_all ON public.era_claim_payments
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.era_remittances IS
  'W52 D4 — ERA remittances + auto-match queue. Spec-shape; coexists with W41 ehr_era_files.';

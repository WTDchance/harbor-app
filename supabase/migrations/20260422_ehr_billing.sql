-- Harbor EHR billing — see docs/harbor-ehr-billing.md for the design.
-- Four new tables: charges, claims, payments, invoices. Superbills table
-- is snapshot-based so it survives charge edits.

-- --- ehr_charges --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ehr_charges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  note_id         UUID REFERENCES public.ehr_progress_notes(id) ON DELETE SET NULL,
  appointment_id  UUID REFERENCES public.appointments(id) ON DELETE SET NULL,

  cpt_code        TEXT NOT NULL,
  units           INTEGER NOT NULL DEFAULT 1,
  fee_cents       BIGINT NOT NULL,
  allowed_cents   BIGINT NOT NULL,
  copay_cents     BIGINT NOT NULL DEFAULT 0,
  billed_to       TEXT NOT NULL DEFAULT 'insurance'
                    CHECK (billed_to IN ('insurance','patient_self_pay','both')),

  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','submitted','partial','paid','denied','written_off','void')),

  service_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  place_of_service TEXT, -- '02' telehealth, '11' office, etc.

  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_charges_practice_patient
  ON public.ehr_charges (practice_id, patient_id, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_ehr_charges_practice_status
  ON public.ehr_charges (practice_id, status, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_ehr_charges_note
  ON public.ehr_charges (note_id) WHERE note_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ehr_charges_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ehr_charges_touch ON public.ehr_charges;
CREATE TRIGGER trg_ehr_charges_touch BEFORE UPDATE ON public.ehr_charges
  FOR EACH ROW EXECUTE FUNCTION public.ehr_charges_touch();

ALTER TABLE public.ehr_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_charges_select ON public.ehr_charges;
CREATE POLICY ehr_charges_select ON public.ehr_charges FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_charges_insert ON public.ehr_charges;
CREATE POLICY ehr_charges_insert ON public.ehr_charges FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_charges_update ON public.ehr_charges;
CREATE POLICY ehr_charges_update ON public.ehr_charges FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- --- ehr_payments -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ehr_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  charge_id       UUID REFERENCES public.ehr_charges(id) ON DELETE SET NULL,

  source          TEXT NOT NULL CHECK (source IN (
                    'patient_stripe', 'insurance_era',
                    'manual_check', 'manual_cash', 'manual_card_external', 'adjustment'
                  )),
  amount_cents    BIGINT NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  stripe_payment_intent_id TEXT,
  era_json        JSONB,
  note            TEXT,

  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_payments_practice_patient
  ON public.ehr_payments (practice_id, patient_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ehr_payments_charge
  ON public.ehr_payments (charge_id) WHERE charge_id IS NOT NULL;

ALTER TABLE public.ehr_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_payments_select ON public.ehr_payments;
CREATE POLICY ehr_payments_select ON public.ehr_payments FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_payments_insert ON public.ehr_payments;
CREATE POLICY ehr_payments_insert ON public.ehr_payments FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- --- ehr_claims ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ehr_claims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id       UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  charge_id         UUID NOT NULL REFERENCES public.ehr_charges(id) ON DELETE CASCADE,
  payer_name        TEXT NOT NULL,
  payer_id_external TEXT,
  control_number    TEXT NOT NULL UNIQUE,

  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','submitted','accepted','rejected','paid','denied')),
  submitted_at      TIMESTAMPTZ,
  stedi_claim_id    TEXT,
  stedi_response_json JSONB,
  rejection_reason  TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_claims_practice_status
  ON public.ehr_claims (practice_id, status, created_at DESC);

ALTER TABLE public.ehr_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_claims_select ON public.ehr_claims;
CREATE POLICY ehr_claims_select ON public.ehr_claims FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- --- ehr_invoices -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ehr_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  charge_ids      UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  subtotal_cents  BIGINT NOT NULL,
  total_cents     BIGINT NOT NULL,
  paid_cents      BIGINT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sent','partial','paid','void')),

  stripe_invoice_id  TEXT,
  stripe_payment_url TEXT,

  sent_at         TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  due_date        DATE,

  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ehr_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_invoices_select ON public.ehr_invoices;
CREATE POLICY ehr_invoices_select ON public.ehr_invoices FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- --- ehr_superbills (snapshot) -----------------------------------------
CREATE TABLE IF NOT EXISTS public.ehr_superbills (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  from_date       DATE NOT NULL,
  to_date         DATE NOT NULL,
  charges_snapshot_json JSONB NOT NULL,
  total_cents     BIGINT NOT NULL,
  generated_by    UUID,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ehr_superbills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_superbills_select ON public.ehr_superbills;
CREATE POLICY ehr_superbills_select ON public.ehr_superbills FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- --- practice-level billing config -------------------------------------
ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS default_fee_schedule_cents JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS billing_tax_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_npi TEXT,
  ADD COLUMN IF NOT EXISTS billing_address TEXT,
  ADD COLUMN IF NOT EXISTS stedi_mode TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (stedi_mode IN ('sandbox','production'));

COMMENT ON COLUMN public.practices.default_fee_schedule_cents IS
  'Map from CPT code to fee in cents. Used to auto-price charges on note sign. '
  'Fallback to DEFAULT_FEE_FALLBACK_CENTS when a CPT is not in the map.';

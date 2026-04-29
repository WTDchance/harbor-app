-- Wave 51 / D2 — reception leads.
--
-- Reception-only practices capture intake calls but DO NOT run a
-- clinical workflow on those records. The receptionist webhook
-- creates a reception_leads row instead of a patients row when the
-- practice is on the reception_only product tier.

-- The spec uses `calls(id)` as the FK target. Harbor's call data lives
-- in `call_logs(id)`, so we use that. Documented here for future
-- migrations.

CREATE TABLE IF NOT EXISTS public.reception_leads (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  call_id                  UUID REFERENCES public.call_logs(id) ON DELETE SET NULL,

  first_name               TEXT,
  last_name                TEXT,
  date_of_birth            DATE,
  phone_e164               TEXT,
  email                    TEXT,
  insurance_payer          TEXT,
  insurance_member_id      TEXT,
  insurance_group_number   TEXT,
  reason_for_visit         TEXT,
  urgency_level            TEXT CHECK (urgency_level IS NULL OR urgency_level IN ('low', 'medium', 'high', 'crisis')),
  preferred_therapist      TEXT,
  preferred_appointment_window TEXT,
  notes                    TEXT,

  status                   TEXT NOT NULL DEFAULT 'new'
                             CHECK (status IN ('new', 'contacted', 'scheduled', 'imported_to_ehr', 'discarded')),

  exported_at              TIMESTAMPTZ,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reception_leads_practice_status
  ON public.reception_leads (practice_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reception_leads_call
  ON public.reception_leads (practice_id, call_id, created_at DESC)
  WHERE call_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reception_leads_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reception_leads_updated_at ON public.reception_leads;
CREATE TRIGGER trg_reception_leads_updated_at
  BEFORE UPDATE ON public.reception_leads
  FOR EACH ROW EXECUTE FUNCTION public.reception_leads_touch();

ALTER TABLE public.reception_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reception_leads_all ON public.reception_leads;
CREATE POLICY reception_leads_all ON public.reception_leads
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.reception_leads IS
  'W51 D2 — reception_only practices keep intake records here instead of in patients(). '
  'Per-call rows; status lifecycle ends at imported_to_ehr / discarded.';

-- Wave 51 / D4 — outbound webhook for reception lead lifecycle events.

CREATE TABLE IF NOT EXISTS public.practice_lead_webhook_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  webhook_url     TEXT NOT NULL,
  webhook_secret_encrypted TEXT NOT NULL,    -- KMS-encrypted via lib/aws/token-encryption
  event_types     TEXT[] NOT NULL DEFAULT ARRAY['lead.created','lead.updated']::text[],
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (practice_id)
);

CREATE OR REPLACE FUNCTION public.practice_lead_webhook_config_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_practice_lead_webhook_config_updated_at ON public.practice_lead_webhook_config;
CREATE TRIGGER trg_practice_lead_webhook_config_updated_at
  BEFORE UPDATE ON public.practice_lead_webhook_config
  FOR EACH ROW EXECUTE FUNCTION public.practice_lead_webhook_config_touch();

ALTER TABLE public.practice_lead_webhook_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_lead_webhook_config_all ON public.practice_lead_webhook_config;
CREATE POLICY practice_lead_webhook_config_all ON public.practice_lead_webhook_config
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Delivery log for the recent-deliveries panel.
CREATE TABLE IF NOT EXISTS public.lead_webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  config_id       UUID REFERENCES public.practice_lead_webhook_config(id) ON DELETE SET NULL,
  lead_id         UUID REFERENCES public.reception_leads(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  url             TEXT NOT NULL,

  attempt         INT NOT NULL DEFAULT 1,
  http_status     INT,
  response_excerpt TEXT,
  delivered_at    TIMESTAMPTZ,
  failed_reason   TEXT,
  next_attempt_at TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_webhook_deliveries_practice_recent
  ON public.lead_webhook_deliveries (practice_id, created_at DESC);

ALTER TABLE public.lead_webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_webhook_deliveries_all ON public.lead_webhook_deliveries;
CREATE POLICY lead_webhook_deliveries_all ON public.lead_webhook_deliveries
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.practice_lead_webhook_config IS
  'W51 D4 — practice-configured outbound webhook for reception_leads lifecycle events.';

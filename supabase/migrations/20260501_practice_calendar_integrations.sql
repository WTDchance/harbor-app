-- Wave 51 / D3 — practice-level calendar OAuth integrations.
--
-- Distinct from the legacy `calendar_connections` table (Wave 18+),
-- which stored Google + Apple CalDAV connections with PLAINTEXT tokens.
-- This table holds AWS-KMS-encrypted refresh/access tokens and is the
-- source of truth for the new reception_only practice's calendar
-- integration UI. Existing calendar_connections rows continue to work
-- for legacy EHR flows; new code reads/writes practice_calendar_integrations.

CREATE TABLE IF NOT EXISTS public.practice_calendar_integrations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id                 UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  therapist_id                UUID REFERENCES public.therapists(id) ON DELETE SET NULL,

  provider                    TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
  account_email               TEXT NOT NULL,

  -- KMS-encrypted blob, format `v1:<alg>:<base64>` from lib/aws/token-encryption.
  refresh_token_encrypted     TEXT NOT NULL,
  access_token_encrypted      TEXT,
  access_token_expires_at     TIMESTAMPTZ,

  scopes                      TEXT[] NOT NULL DEFAULT '{}',
  status                      TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'revoked', 'reauth_required')),

  last_sync_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT practice_calendar_integrations_unique
    UNIQUE (practice_id, therapist_id, provider, account_email)
);

CREATE INDEX IF NOT EXISTS idx_practice_calendar_integrations_practice
  ON public.practice_calendar_integrations (practice_id, status, provider);

CREATE OR REPLACE FUNCTION public.practice_calendar_integrations_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_practice_calendar_integrations_updated_at ON public.practice_calendar_integrations;
CREATE TRIGGER trg_practice_calendar_integrations_updated_at
  BEFORE UPDATE ON public.practice_calendar_integrations
  FOR EACH ROW EXECUTE FUNCTION public.practice_calendar_integrations_touch();

ALTER TABLE public.practice_calendar_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_calendar_integrations_all ON public.practice_calendar_integrations;
CREATE POLICY practice_calendar_integrations_all ON public.practice_calendar_integrations
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.practice_calendar_integrations IS
  'W51 D3 — Google / Outlook calendar OAuth tokens, KMS-encrypted at rest. '
  'Source of truth for reception_only calendar sync.';

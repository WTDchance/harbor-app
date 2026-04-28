-- Wave 48 / T2 — public API keys for Reception integrations.
--
-- Third-party EHRs (Ensora marketplace partners specifically) need
-- programmatic access to Reception. Each practice can mint API keys
-- with scoped permissions; the plaintext is shown ONCE at creation
-- time and never recoverable (we store SHA-256 hash + first 12-char
-- prefix for lookup).
--
-- Key format: hb_live_<32 base32 chars>
-- Lookup: SHA-256 hash of the full key, joined to the row by exact
-- hash match. key_prefix = 'hb_live_AAAA' style (first 12 chars) for
-- display in dashboards.

CREATE TABLE IF NOT EXISTS public.reception_api_keys (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id        UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  -- SHA-256(plaintext_key) hex. Unique so a collision (cosmic-ray
  -- chance) doesn't silently authenticate the wrong practice.
  key_hash           TEXT NOT NULL UNIQUE,
  -- First 12 chars of the plaintext (e.g. 'hb_live_ABCD'). Surfaced
  -- in the dashboard list so operators can identify a key by sight.
  key_prefix         TEXT NOT NULL,

  -- Scope strings the key can request. e.g. {'agents:read','agents:write',
  -- 'calls:read','appointments:read','appointments:write'}.
  scopes             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  created_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- last_used_at is updated on every successful verifyApiKey call,
  -- sampled to avoid hot-row contention (every Nth call writes).
  last_used_at       TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reception_api_keys_practice
  ON public.reception_api_keys (practice_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_reception_api_keys_prefix
  ON public.reception_api_keys (key_prefix);
CREATE INDEX IF NOT EXISTS idx_reception_api_keys_active
  ON public.reception_api_keys (practice_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.reception_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reception_api_keys_select ON public.reception_api_keys;
CREATE POLICY reception_api_keys_select ON public.reception_api_keys
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- INSERT/UPDATE/DELETE go through the service-role pool from API
-- routes (the Reception signup flow can run pre-Cognito); RLS isn't
-- the gate.

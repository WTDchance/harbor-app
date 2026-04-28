-- Wave 47 — Reception product split.
--
-- API keys for the public Reception REST API. Third-party EHRs (Ensora,
-- SimplePractice, etc.) authenticate to /api/reception/v1/* with
-- "Authorization: Bearer hb_live_<32chars>". The plaintext key is shown
-- to the practice exactly once on creation; only its SHA-256 hash and a
-- short prefix (for UI display) are persisted.
--
-- Scopes are stored as TEXT[] (e.g. {agents:read, agents:write}). The
-- caller's effective scope set is checked at the route level.
--
-- revoked_at NULL = key is active. last_used_at is bumped on every
-- successful verifyApiKey() lookup (best-effort, never blocks).

CREATE TABLE IF NOT EXISTS reception_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reception_api_keys_practice_id
  ON reception_api_keys(practice_id);

CREATE INDEX IF NOT EXISTS idx_reception_api_keys_key_prefix
  ON reception_api_keys(key_prefix);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reception_api_keys_key_hash
  ON reception_api_keys(key_hash);

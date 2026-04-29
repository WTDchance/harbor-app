-- Wave 51 / D7 — per-practice AI receptionist voice id.

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS ai_voice_id TEXT;

COMMENT ON COLUMN public.practices.ai_voice_id IS
  'W51 D7 — Retell voice id used for the practice''s AI receptionist. '
  'NULL = use the application default. Synced to the Retell agent on save.';

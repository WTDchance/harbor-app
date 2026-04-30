-- Wave 52 / D6 — 24h phone-number reservations during onboarding.

CREATE TABLE IF NOT EXISTS public.practice_phone_reservations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  phone_number    TEXT NOT NULL,
  region          TEXT,
  locality        TEXT,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  released_at     TIMESTAMPTZ,
  claimed_at      TIMESTAMPTZ,
  reserved_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_reservations_practice
  ON public.practice_phone_reservations (practice_id, expires_at DESC)
  WHERE released_at IS NULL AND claimed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_phone_reservation_active
  ON public.practice_phone_reservations (phone_number)
  WHERE released_at IS NULL AND claimed_at IS NULL;

ALTER TABLE public.practice_phone_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_phone_reservations_all ON public.practice_phone_reservations;
CREATE POLICY practice_phone_reservations_all ON public.practice_phone_reservations
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

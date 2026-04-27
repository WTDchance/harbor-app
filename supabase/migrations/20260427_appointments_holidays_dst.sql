-- Wave 43 / T1 — recurring appointment edge cases.
--
-- W38 TS1 shipped RRULE-based recurrence but didn't handle:
--   1. DST transitions — a weekly recurrence anchored on a 9am
--      Monday in winter would silently become a 10am Monday in
--      summer when expanded naively in UTC. Patients expect their
--      9am to stay 9am.
--   2. Federal-holiday occurrences — the recurrence might land on
--      Christmas; the therapist wants a heads-up rather than a
--      silent booking.
--
-- Two flags on appointments + an optional per-practice holiday
-- table for custom days off (firm closure days, in-service days,
-- etc.).

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS holiday_exception BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dst_adjusted      BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.appointments.holiday_exception IS
  'TRUE when the materialized occurrence falls on a US federal holiday '
  'or a practice-custom holiday (ehr_practice_holidays). The row is '
  'still inserted — the therapist decides whether to keep, move, or '
  'cancel it. False by default + on non-recurring rows.';

COMMENT ON COLUMN public.appointments.dst_adjusted IS
  'TRUE when the recurrence expander adjusted the UTC timestamp by ±1h '
  'to preserve the patient''s local clock time across a DST transition. '
  'Recurrence anchored on 9am local stays 9am local. False by default '
  'and on rows that did not cross a DST boundary.';

-- Per-practice custom holidays (firm closure days, training days, etc.).
-- US federal holidays are hardcoded in lib/aws/ehr/holidays.ts; this
-- table covers the rest.
CREATE TABLE IF NOT EXISTS public.ehr_practice_holidays (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  name         TEXT NOT NULL,
  notes        TEXT,
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (practice_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_practice_holidays_lookup
  ON public.ehr_practice_holidays (practice_id, holiday_date);

ALTER TABLE public.ehr_practice_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_holidays_select ON public.ehr_practice_holidays;
CREATE POLICY practice_holidays_select ON public.ehr_practice_holidays
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS practice_holidays_insert ON public.ehr_practice_holidays;
CREATE POLICY practice_holidays_insert ON public.ehr_practice_holidays
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS practice_holidays_delete ON public.ehr_practice_holidays;
CREATE POLICY practice_holidays_delete ON public.ehr_practice_holidays
  FOR DELETE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Practice timezone — IANA name (e.g. America/Los_Angeles). Used by
-- the recurrence expander to preserve local clock time across DST and
-- by holiday detection so a Christmas appointment is flagged whether
-- the practice is in Anchorage or New York. Default
-- 'America/Los_Angeles' matches the Klamath Falls test practice; new
-- practices are prompted to set this in onboarding.
ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles';

COMMENT ON COLUMN public.practices.timezone IS
  'IANA timezone (e.g. America/Los_Angeles). Drives DST-preserving '
  'recurrence expansion and holiday detection on appointments.';

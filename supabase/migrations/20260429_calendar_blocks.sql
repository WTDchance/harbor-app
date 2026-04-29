-- Wave 49 / T5 — calendar event types beyond appointments.
--
-- Therapists block time for supervision, admin, lunch, vacation,
-- "no-bookings" windows. Today Harbor only models appointments —
-- therapists end up using Google Calendar separately for everything
-- else. This table fills the gap.
--
-- Self-scheduling (W42 T1) and AI receptionist booking will read
-- these blocks and refuse to offer overlapping slots. The slot-
-- conflict check is enforced at the API layer (the existing
-- availability endpoint joins this table); no DB constraint needed
-- because therapists may legitimately want overlapping personal
-- blocks ("admin while at lunch").

CREATE TABLE IF NOT EXISTS public.ehr_calendar_blocks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id   UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id)     ON DELETE CASCADE,

  kind          TEXT NOT NULL DEFAULT 'admin'
                  CHECK (kind IN ('supervision','admin','lunch','vacation','training','other')),
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),

  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),

  is_recurring  BOOLEAN NOT NULL DEFAULT FALSE,
  -- RFC 5545 RRULE string (same dialect as W43 T1 appointment
  -- recurrences). NULL when is_recurring=false. The slot-conflict
  -- query expands occurrences in-app via lib/aws/ehr/recurrence.
  recurrence_rule TEXT,

  -- Visual hint for the calendar — palette aligned with the W47 T4
  -- patient flag colors plus a couple of neutrals.
  color         TEXT NOT NULL DEFAULT 'gray'
                  CHECK (color IN ('blue','green','yellow','red','gray','purple')),

  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_blocks_user_window
  ON public.ehr_calendar_blocks (practice_id, user_id, starts_at, ends_at);

-- Practice-wide window query (admins viewing the team calendar).
CREATE INDEX IF NOT EXISTS idx_calendar_blocks_practice_window
  ON public.ehr_calendar_blocks (practice_id, starts_at, ends_at);

CREATE OR REPLACE FUNCTION public.ehr_calendar_blocks_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_calendar_blocks_touch ON public.ehr_calendar_blocks;
CREATE TRIGGER trg_calendar_blocks_touch
  BEFORE UPDATE ON public.ehr_calendar_blocks
  FOR EACH ROW EXECUTE FUNCTION public.ehr_calendar_blocks_touch();

ALTER TABLE public.ehr_calendar_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_blocks_select ON public.ehr_calendar_blocks;
CREATE POLICY calendar_blocks_select ON public.ehr_calendar_blocks
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Modify only the owning user (admins use service-role pool from API
-- routes if they need cross-user edits).
DROP POLICY IF EXISTS calendar_blocks_self_modify ON public.ehr_calendar_blocks;
CREATE POLICY calendar_blocks_self_modify ON public.ehr_calendar_blocks
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid()
              AND practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Wave 38 TS1 — recurring appointments via RFC 5545 RRULE.
--
-- Strategy: parent appointment owns the rule + N materialized child rows.
-- Children carry recurrence_parent_id; editing a child can detach it from
-- the series ("this only"), edit-and-future-of edits the rule on the
-- pivoting child onward, edit-all replays the rule across all children.
-- See lib/aws/ehr/recurrence.ts for expand() + edit semantics.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS recurrence_rule TEXT;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS recurrence_parent_id UUID
    REFERENCES public.appointments(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.appointments.recurrence_rule IS
  'RFC 5545 RRULE string (e.g. FREQ=WEEKLY;COUNT=12). Set only on the *parent* appointment of a series; children carry recurrence_parent_id back to that parent.';

COMMENT ON COLUMN public.appointments.recurrence_parent_id IS
  'Parent appointment id when this row is a materialized recurrence child. NULL for one-offs and for the series parent itself.';

CREATE INDEX IF NOT EXISTS idx_appointments_recurrence_parent
  ON public.appointments (recurrence_parent_id)
  WHERE recurrence_parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_recurrence_rule
  ON public.appointments (practice_id, recurrence_rule)
  WHERE recurrence_rule IS NOT NULL;

-- Week 3 part 2: mood check-ins + recurring assessment schedules.

-- ehr_mood_logs — quick between-session check-ins from the portal.
-- Patient taps a 1-10 mood slider + optional one-line note. Aggregated on
-- the therapist side to show trends between sessions.
CREATE TABLE IF NOT EXISTS public.ehr_mood_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id   UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  mood         SMALLINT NOT NULL CHECK (mood BETWEEN 1 AND 10),
  anxiety      SMALLINT CHECK (anxiety BETWEEN 1 AND 10),
  sleep_hours  NUMERIC(4,1),
  note         TEXT,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_mood_logs_patient_date
  ON public.ehr_mood_logs (practice_id, patient_id, logged_at DESC);

ALTER TABLE public.ehr_mood_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_mood_select ON public.ehr_mood_logs;
CREATE POLICY ehr_mood_select ON public.ehr_mood_logs FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- ehr_assessment_schedules — recurring assignment of an instrument to a
-- patient. A cron job reads this and creates a new pending row in
-- patient_assessments whenever "next_due_at" falls in the past.
CREATE TABLE IF NOT EXISTS public.ehr_assessment_schedules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id       UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id        UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  assessment_type   TEXT NOT NULL,
  cadence_weeks     INTEGER NOT NULL CHECK (cadence_weeks BETWEEN 1 AND 52),
  next_due_at       TIMESTAMPTZ NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, assessment_type)
);

CREATE INDEX IF NOT EXISTS idx_ehr_sched_due
  ON public.ehr_assessment_schedules (is_active, next_due_at)
  WHERE is_active = true;

ALTER TABLE public.ehr_assessment_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_sched_select ON public.ehr_assessment_schedules;
CREATE POLICY ehr_sched_select ON public.ehr_assessment_schedules FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_sched_insert ON public.ehr_assessment_schedules;
CREATE POLICY ehr_sched_insert ON public.ehr_assessment_schedules FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS ehr_sched_update ON public.ehr_assessment_schedules;
CREATE POLICY ehr_sched_update ON public.ehr_assessment_schedules FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

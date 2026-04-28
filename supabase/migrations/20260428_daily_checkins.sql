-- Wave 46 / T5 — patient daily mood/symptom check-in.
--
-- Optional per-patient daily check-in via the portal. Patient picks a
-- 1-5 mood emoji + optional symptom checklist + optional note.
-- Therapist sees an aggregated 30-day trend on the patient detail page.
--
-- Feeds into W45 engagement signals: each completed check-in writes a
-- daily_checkin_completed signal (positive engagement input).

CREATE TABLE IF NOT EXISTS public.ehr_daily_checkins (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,

  -- 1 = very low, 5 = very high. Patient picks an emoji that maps to
  -- this scale. NULL is not allowed — a check-in is a check-in.
  mood_score      SMALLINT NOT NULL CHECK (mood_score BETWEEN 1 AND 5),

  -- Free-form symptom keywords. Practice can extend the picker; the
  -- column is text[] not enum so customization doesn't migrate.
  symptoms        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  note            TEXT,

  -- How the check-in was prompted. Drives the W45 signal source field.
  prompted_via    TEXT NOT NULL DEFAULT 'portal_visit'
                    CHECK (prompted_via IN ('portal_visit','sms','email','manual')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One check-in per patient per UTC day. Re-submission updates the
-- existing row instead of creating a duplicate; the API handles this
-- via UPSERT on the partial unique index below.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ehr_daily_checkins_patient_day
  ON public.ehr_daily_checkins (practice_id, patient_id, ((created_at AT TIME ZONE 'UTC')::date));

CREATE INDEX IF NOT EXISTS idx_ehr_daily_checkins_patient_recent
  ON public.ehr_daily_checkins (practice_id, patient_id, created_at DESC);

ALTER TABLE public.ehr_daily_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_checkins_select ON public.ehr_daily_checkins;
CREATE POLICY daily_checkins_select ON public.ehr_daily_checkins
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Patient-portal INSERT goes through pool.query in API routes (service
-- role), bypassing RLS; that's intentional since portal sessions are
-- not Cognito users. The auth lives in the route layer.

-- Therapist-side preferences: allow opt-in reminders per patient. Stored
-- as a column on the patient row to avoid a separate-row pattern for what
-- is just a flag + time-of-day.
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS daily_checkin_reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS daily_checkin_reminder_local_time TEXT;
COMMENT ON COLUMN public.patients.daily_checkin_reminder_local_time IS
  'HH:MM in the practice timezone for the daily check-in nudge. NULL = no reminder.';

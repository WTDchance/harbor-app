-- Week 6 part 1: secure messaging + patient scheduling requests.

-- Secure messaging threads + messages
CREATE TABLE IF NOT EXISTS public.ehr_message_threads (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id               UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id                UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  subject                   TEXT NOT NULL DEFAULT 'New conversation',
  last_message_at           TIMESTAMPTZ,
  last_message_preview      TEXT,
  unread_by_patient_count   INTEGER NOT NULL DEFAULT 0,
  unread_by_practice_count  INTEGER NOT NULL DEFAULT 0,
  archived_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_threads_practice_patient
  ON public.ehr_message_threads (practice_id, patient_id, last_message_at DESC);

ALTER TABLE public.ehr_message_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_threads_select ON public.ehr_message_threads;
CREATE POLICY ehr_threads_select ON public.ehr_message_threads FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.ehr_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       UUID NOT NULL REFERENCES public.ehr_message_threads(id) ON DELETE CASCADE,
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  sender_type     TEXT NOT NULL CHECK (sender_type IN ('patient','practice')),
  sender_user_id  UUID, -- therapist's auth.users.id when sender_type='practice'
  body            TEXT NOT NULL,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_messages_thread
  ON public.ehr_messages (thread_id, created_at ASC);

ALTER TABLE public.ehr_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_messages_select ON public.ehr_messages;
CREATE POLICY ehr_messages_select ON public.ehr_messages FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Scheduling requests (patient asks for an appointment; therapist confirms)
CREATE TABLE IF NOT EXISTS public.ehr_scheduling_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id       UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id        UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  preferred_windows JSONB NOT NULL DEFAULT '[]'::JSONB, -- [{ date, start, end }]
  patient_note      TEXT,
  therapist_note    TEXT,
  duration_minutes  INTEGER NOT NULL DEFAULT 45,
  appointment_type  TEXT NOT NULL DEFAULT 'follow-up',
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','declined','cancelled')),
  appointment_id    UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at      TIMESTAMPTZ,
  responded_by      UUID
);

CREATE INDEX IF NOT EXISTS idx_ehr_sched_requests_practice_status
  ON public.ehr_scheduling_requests (practice_id, status, created_at DESC);

ALTER TABLE public.ehr_scheduling_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_sched_req_select ON public.ehr_scheduling_requests;
CREATE POLICY ehr_sched_req_select ON public.ehr_scheduling_requests FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

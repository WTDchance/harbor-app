-- Wave 42 / T5 — telehealth video recording (Chime Media Pipelines).
--
-- W38 TS2 shipped Chime telehealth video without recording. This
-- adds optional session recording, gated by patient consent. The
-- recording goes to an S3 bucket with KMS encryption + 7-year
-- retention (HIPAA standard).
--
-- Two changes:
--   1. ehr_telehealth_recordings — one row per recording session.
--      Recording lifecycle (started -> stopped -> available -> deleted)
--      tracked here so an aborted Media Pipeline doesn't leave
--      dangling state.
--   2. Audit trail through the existing audit_logs.
--
-- Consent track: we deliberately use the existing consent_documents
-- + consent_signatures system (W38 TS4) with a NEW kind value
-- 'telehealth_recording'. The consent_documents.kind column is
-- open-ended TEXT (no CHECK constraint), so no schema change there.
-- The recording start endpoint refuses to start without an active
-- signature with kind='telehealth_recording'.

CREATE TABLE IF NOT EXISTS public.ehr_telehealth_recordings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id        UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  practice_id           UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,

  chime_meeting_id      TEXT NOT NULL,
  chime_pipeline_id     TEXT,                              -- MediaPipelineId; set on start
  s3_bucket             TEXT,                              -- KMS-encrypted bucket
  s3_key_prefix         TEXT,                              -- where Chime writes recording artifacts

  consent_signature_id  UUID REFERENCES public.consent_signatures(id) ON DELETE SET NULL,

  started_by_user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at            TIMESTAMPTZ,
  stopped_by_user_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,

  status                TEXT NOT NULL DEFAULT 'starting'
                          CHECK (status IN (
                            'starting',     -- pipeline create called, awaiting Chime ack
                            'recording',    -- pipeline live
                            'stopping',     -- stop called, awaiting flush
                            'available',    -- artifacts in S3, downloadable
                            'deleted',      -- artifacts purged (retention or operator action)
                            'error'         -- terminal failure
                          )),
  error_reason          TEXT,

  duration_seconds      INTEGER,                           -- computed at stop
  retention_until       DATE,                              -- 7 years from started_at by default

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ehr_telehealth_recordings IS
  'Chime SDK Media Pipelines recordings per telehealth meeting. Gated '
  'by an active consent_signatures row with kind=''telehealth_recording''. '
  'Therapist-controlled start/stop. KMS-encrypted S3, 7-year retention.';

CREATE INDEX IF NOT EXISTS idx_telehealth_recordings_appointment
  ON public.ehr_telehealth_recordings (appointment_id);
CREATE INDEX IF NOT EXISTS idx_telehealth_recordings_patient
  ON public.ehr_telehealth_recordings (patient_id, started_at DESC);
-- One active recording per meeting at a time (recording, stopping,
-- starting all count as 'in progress').
CREATE UNIQUE INDEX IF NOT EXISTS uq_telehealth_recordings_active
  ON public.ehr_telehealth_recordings (chime_meeting_id)
  WHERE status IN ('starting','recording','stopping');

CREATE OR REPLACE FUNCTION public.telehealth_recordings_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_telehealth_recordings_touch ON public.ehr_telehealth_recordings;
CREATE TRIGGER trg_telehealth_recordings_touch
  BEFORE UPDATE ON public.ehr_telehealth_recordings
  FOR EACH ROW EXECUTE FUNCTION public.telehealth_recordings_touch();

ALTER TABLE public.ehr_telehealth_recordings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telehealth_recordings_select ON public.ehr_telehealth_recordings;
CREATE POLICY telehealth_recordings_select ON public.ehr_telehealth_recordings
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS telehealth_recordings_insert ON public.ehr_telehealth_recordings;
CREATE POLICY telehealth_recordings_insert ON public.ehr_telehealth_recordings
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS telehealth_recordings_update ON public.ehr_telehealth_recordings;
CREATE POLICY telehealth_recordings_update ON public.ehr_telehealth_recordings
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

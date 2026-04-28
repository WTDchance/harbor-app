-- Wave 45 / T1 — patient_signals foundation.
--
-- Append-only event stream of every observable patient interaction
-- relevant to predicting future behavior (no-show, dropout,
-- reschedule willingness, etc.). Read-side only — the source of
-- truth remains the operational tables (appointments, ehr_payments,
-- portal_sessions, etc.). This stream is denormalized so prediction
-- compute can hit one table.
--
-- Wave 45 ships heuristic predictions; Wave 46+ trains ML models on
-- the same rows. Keep the schema stable.

CREATE TABLE IF NOT EXISTS public.ehr_patient_signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id   UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id    UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,

  -- Signal kind. New kinds may be added without a migration — the
  -- only contract is that ingestion is idempotent on
  -- (practice_id, patient_id, signal_kind, observed_at, source).
  signal_kind   TEXT NOT NULL,

  -- Free-form payload. For appointment_kept this might be
  -- { appointment_id, scheduled_for, duration_minutes }; for
  -- assessment_score it's { score, subscale, instrument } etc.
  -- Schema-light by design — the prediction layer pulls what it
  -- needs and ignores the rest.
  value         JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- When the underlying event happened (NOT when we learned about
  -- it). Recency-weighted features in the prediction layer key off
  -- this column.
  observed_at   TIMESTAMPTZ NOT NULL,

  -- Where this signal came from. Free-form string; common values:
  -- 'appointments_table', 'ehr_payments', 'portal_sessions',
  -- 'audit_logs', 'sms_conversations', 'retell_call', 'manual_override'.
  source        TEXT NOT NULL,

  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotency: ingestion never inserts the same signal twice.
  -- (practice_id, patient_id, signal_kind, observed_at, source) is
  -- typically enough granularity; for signals that fire multiple
  -- times within a single (kind, second), include a discriminator
  -- in `value` so the unique key holds.
  UNIQUE (practice_id, patient_id, signal_kind, observed_at, source)
);

CREATE INDEX IF NOT EXISTS idx_patient_signals_patient_recent
  ON public.ehr_patient_signals (practice_id, patient_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_signals_kind_recent
  ON public.ehr_patient_signals (practice_id, signal_kind, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_signals_value_gin
  ON public.ehr_patient_signals USING GIN (value);

ALTER TABLE public.ehr_patient_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_signals_select ON public.ehr_patient_signals;
CREATE POLICY patient_signals_select ON public.ehr_patient_signals
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS patient_signals_insert ON public.ehr_patient_signals;
CREATE POLICY patient_signals_insert ON public.ehr_patient_signals
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.ehr_patient_signals IS
  'Append-only event stream feeding W45 heuristic + W46+ ML '
  'predictions. Idempotent on (practice_id, patient_id, signal_kind, '
  'observed_at, source).';

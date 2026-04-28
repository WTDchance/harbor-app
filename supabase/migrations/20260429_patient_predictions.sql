-- Wave 45 / T2 — patient_predictions foundation.
--
-- One row per (practice, patient, prediction_kind) representing the
-- current model's view of that patient. UPSERTs on each compute
-- pass so therapists always see the latest score.
--
-- factors JSONB carries the per-input contributions so the UI can
-- explain WHY a patient is flagged. Shape (heuristic v1):
--   { contributions: [{ name, weight, value, normalized_score }],
--     formula_version: 'no_show.v1',
--     summary: 'High historical no-show rate + recent late cancel' }
--
-- model_version distinguishes heuristic-v1 from later ML models so
-- the accuracy dashboard (T7) can compare versions over time.

CREATE TABLE IF NOT EXISTS public.ehr_patient_predictions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,

  prediction_kind TEXT NOT NULL,             -- 'no_show'|'reschedule_willingness'|'engagement_score'|'dropout_risk'

  -- Calibrated 0..1 probability for binary kinds, raw 0..1 for the
  -- composite kinds (engagement, dropout). Convention: higher = more
  -- of the named outcome. So no_show=0.9 means very likely to no-show;
  -- engagement_score=0.9 means highly engaged; dropout_risk=0.9 means
  -- very likely to drop out.
  score           NUMERIC(4,3) NOT NULL CHECK (score >= 0 AND score <= 1),

  factors         JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_version   TEXT NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Optional: tied to a specific appointment for no_show predictions
  -- (we recompute on appointment create + before each reminder send).
  -- NULL for kinds that don't have a per-event scope (engagement,
  -- dropout). The unique index below handles both shapes.
  appointment_id  UUID REFERENCES public.appointments(id) ON DELETE CASCADE,

  -- Therapist override: when a clinician sees the prediction, applies
  -- judgment, and disagrees. Captured so the model can later learn
  -- from disagreements (and so override doesn't get re-overwritten by
  -- the next compute pass — see WHERE clause on the upsert).
  override_score  NUMERIC(4,3) CHECK (override_score IS NULL OR (override_score >= 0 AND override_score <= 1)),
  override_reason TEXT,
  override_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  override_at     TIMESTAMPTZ
);

-- Per-patient kind: when appointment_id is NULL, only one row per
-- (practice, patient, kind). When appointment_id is set, one row per
-- (practice, patient, kind, appointment_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_predictions_patient_kind
  ON public.ehr_patient_predictions (practice_id, patient_id, prediction_kind)
  WHERE appointment_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_predictions_appt_kind
  ON public.ehr_patient_predictions (practice_id, patient_id, prediction_kind, appointment_id)
  WHERE appointment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_predictions_practice_kind
  ON public.ehr_patient_predictions (practice_id, prediction_kind, score DESC, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_predictions_patient_recent
  ON public.ehr_patient_predictions (practice_id, patient_id, computed_at DESC);

ALTER TABLE public.ehr_patient_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_predictions_select ON public.ehr_patient_predictions;
CREATE POLICY patient_predictions_select ON public.ehr_patient_predictions
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS patient_predictions_insert ON public.ehr_patient_predictions;
CREATE POLICY patient_predictions_insert ON public.ehr_patient_predictions
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS patient_predictions_update ON public.ehr_patient_predictions;
CREATE POLICY patient_predictions_update ON public.ehr_patient_predictions
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Outcomes-tracking view used by T7 prediction-accuracy dashboard.
-- Joins predictions to actual outcomes (no-show: did the appointment
-- end status='no_show'? engagement: did the patient have a session
-- in the next 30 days?). Read-only.
COMMENT ON TABLE public.ehr_patient_predictions IS
  'Heuristic + ML prediction outputs. One row per (patient, kind) for '
  'patient-level kinds, one row per (patient, kind, appointment) for '
  'per-appointment kinds. UPSERTed by /api/cron/compute-patient-'
  'predictions. override_* fields capture therapist-side disagreement.';

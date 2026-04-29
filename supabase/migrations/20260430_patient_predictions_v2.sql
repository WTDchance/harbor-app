-- Wave 50 / D3 — predictive patient tables (v2 shape).
--
-- The W50 spec calls for two new tables: a rolling per-patient
-- aggregate (`ehr_patient_signals`) and a per-patient prediction
-- snapshot (`ehr_patient_predictions`). Both names are already used
-- in the W45 schema with different shapes (event-stream + prediction-
-- per-kind respectively), so we add them under v2 names and document
-- the relationship:
--
--   ehr_patient_signal_aggregate  →  the W50-spec "ehr_patient_signals" rolling row
--   ehr_patient_predictions_v2    →  the W50-spec "ehr_patient_predictions" snapshot
--
-- The W45 tables remain in place; predictions_v2 is computed daily
-- alongside the existing prediction layer and surfaced in the new
-- patient-detail risk-chip indicators.

-- Rolling per-patient aggregate. One row per (practice, patient).
CREATE TABLE IF NOT EXISTS public.ehr_patient_signal_aggregate (
  patient_id                UUID PRIMARY KEY REFERENCES public.patients(id) ON DELETE CASCADE,
  practice_id               UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  total_call_signals        INT NOT NULL DEFAULT 0,
  last_sentiment            NUMERIC(4,3),         -- -1..1
  last_urgency              NUMERIC(4,3),         -- 0..1
  last_call_at              TIMESTAMPTZ,

  appointments_kept         INT NOT NULL DEFAULT 0,
  appointments_no_show      INT NOT NULL DEFAULT 0,
  appointments_cancelled    INT NOT NULL DEFAULT 0,

  payments_on_time          INT NOT NULL DEFAULT 0,
  payments_late             INT NOT NULL DEFAULT 0,
  current_balance_cents     INT NOT NULL DEFAULT 0,

  intake_form_completion_pct NUMERIC(5,2) NOT NULL DEFAULT 0, -- 0..100

  consecutive_kept          INT NOT NULL DEFAULT 0,
  last_no_show_at           TIMESTAMPTZ,
  last_appointment_at       TIMESTAMPTZ,
  last_call_hesitation_score NUMERIC(4,3),

  inputs_hash               TEXT,                 -- stable fingerprint of inputs for incremental compute
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_signal_aggregate_practice
  ON public.ehr_patient_signal_aggregate (practice_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.ehr_patient_signal_aggregate_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_patient_signal_aggregate_updated_at ON public.ehr_patient_signal_aggregate;
CREATE TRIGGER trg_ehr_patient_signal_aggregate_updated_at
  BEFORE UPDATE ON public.ehr_patient_signal_aggregate
  FOR EACH ROW EXECUTE FUNCTION public.ehr_patient_signal_aggregate_touch();

ALTER TABLE public.ehr_patient_signal_aggregate ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_patient_signal_aggregate_all ON public.ehr_patient_signal_aggregate;
CREATE POLICY ehr_patient_signal_aggregate_all ON public.ehr_patient_signal_aggregate
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));


-- Per-patient prediction snapshot. We keep history (one row per
-- compute pass with a unique inputs_hash), so audit replay of risk
-- decisions is possible.
CREATE TABLE IF NOT EXISTS public.ehr_patient_predictions_v2 (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id         UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,

  no_show_prob        NUMERIC(4,3) NOT NULL CHECK (no_show_prob >= 0 AND no_show_prob <= 1),
  dropout_prob        NUMERIC(4,3) NOT NULL CHECK (dropout_prob >= 0 AND dropout_prob <= 1),
  payment_risk_score  NUMERIC(4,3) NOT NULL CHECK (payment_risk_score >= 0 AND payment_risk_score <= 1),
  churn_score         NUMERIC(4,3) NOT NULL CHECK (churn_score >= 0 AND churn_score <= 1),

  -- For the UI chip — derived in lib/ehr/predictions.ts from the
  -- max of the four scores so a single Low/Med/High verdict can render.
  composite_severity  TEXT NOT NULL CHECK (composite_severity IN ('low', 'medium', 'high')),

  factors             JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_version       TEXT NOT NULL DEFAULT 'v2-heuristic-1',
  inputs_hash         TEXT NOT NULL,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep the latest snapshot lookup cheap.
CREATE INDEX IF NOT EXISTS idx_patient_predictions_v2_patient_recent
  ON public.ehr_patient_predictions_v2 (practice_id, patient_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_predictions_v2_top_risk
  ON public.ehr_patient_predictions_v2 (practice_id, churn_score DESC, computed_at DESC);

-- Don't double-write the same inputs in a single calendar day.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_patient_predictions_v2_inputs_hash
  ON public.ehr_patient_predictions_v2 (practice_id, patient_id, inputs_hash);

ALTER TABLE public.ehr_patient_predictions_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_patient_predictions_v2_all ON public.ehr_patient_predictions_v2;
CREATE POLICY ehr_patient_predictions_v2_all ON public.ehr_patient_predictions_v2
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.ehr_patient_signal_aggregate IS
  'W50 D3 — rolling per-patient feature row used by lib/ehr/predictions.ts. '
  'Distinct from the W45 ehr_patient_signals event stream (kept separate '
  'so historical signals do not vanish on aggregate refresh).';
COMMENT ON TABLE public.ehr_patient_predictions_v2 IS
  'W50 D3 — composite per-patient prediction snapshot. Append-only. '
  'Distinct from W45 ehr_patient_predictions which uses prediction_kind '
  'discriminator + score columns; v2 carries all four scores per row.';

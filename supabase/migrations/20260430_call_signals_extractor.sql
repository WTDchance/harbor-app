-- Wave 50 / D2 — per-utterance call signals extracted from receptionist
-- transcripts. Distinct from the W45 inferred_*_intent columns on
-- call_logs (those are aggregate booleans per call); this is the
-- granular stream of typed signals (intent/hesitation/urgency/crisis)
-- that powers the patient-detail CallSignalsFeed and the prediction
-- compute step.

CREATE TABLE IF NOT EXISTS public.ehr_call_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  call_id         UUID NOT NULL REFERENCES public.call_logs(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES public.patients(id) ON DELETE SET NULL,

  signal_type     TEXT NOT NULL CHECK (signal_type IN (
                    'intent',
                    'hesitation',
                    'urgency_low',
                    'urgency_medium',
                    'urgency_high',
                    'crisis_flag',
                    'name_candidate',
                    'dob_candidate',
                    'phone_confirmation',
                    'insurance_mention',
                    'scheduling_intent',
                    'scheduling_friction',
                    'sentiment_positive',
                    'sentiment_negative',
                    'dropout_signal',
                    'payment_concern'
                  )),

  signal_value    TEXT,
  confidence      NUMERIC(3,2) NOT NULL DEFAULT 0.5
                    CHECK (confidence >= 0 AND confidence <= 1),

  -- Verbatim 1-3 sentence excerpt the signal was inferred from. Truncated
  -- to keep this stream readable in the UI.
  raw_excerpt     TEXT,

  -- Where the signal came from: 'regex' | 'bedrock' | 'manual_correction'.
  extracted_by    TEXT NOT NULL DEFAULT 'regex',
  extracted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ehr_call_signals_call
  ON public.ehr_call_signals (practice_id, call_id, extracted_at DESC);

CREATE INDEX IF NOT EXISTS idx_ehr_call_signals_patient
  ON public.ehr_call_signals (practice_id, patient_id, extracted_at DESC)
  WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ehr_call_signals_crisis
  ON public.ehr_call_signals (practice_id, extracted_at DESC)
  WHERE signal_type = 'crisis_flag';

ALTER TABLE public.ehr_call_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_call_signals_all ON public.ehr_call_signals;
CREATE POLICY ehr_call_signals_all ON public.ehr_call_signals
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.ehr_call_signals IS
  'W50 D2 — typed per-utterance signals from Retell receptionist transcripts. '
  'Powers the patient-detail CallSignalsFeed and the daily prediction compute. '
  'Distinct from call_logs.inferred_*_intent (aggregate booleans).';

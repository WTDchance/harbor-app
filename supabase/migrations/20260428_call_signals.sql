-- 20260428_call_signals.sql
--
-- Wave 45 — Retell call-transcript signal extraction. The receptionist
-- call layer is unique-to-Harbor data; competitors with the same EHR +
-- payment surfaces literally cannot replicate it. This migration extends
-- call_logs with the per-call inferred signals that the Bedrock-backed
-- extractor (lib/aws/retell/extract-signals.ts) writes after each
-- call_analyzed event.
--
-- Cross-references the broader Wave 45 ehr_patient_signals table owned
-- by the parallel branch (T1). We DO NOT create that table here; this
-- file's writes into ehr_patient_signals are guarded with IF EXISTS in
-- the application layer so the migration order is safe in either
-- direction.
--
-- All columns additive + nullable. Idempotent (safe to re-run).

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS inferred_no_show_intent      BOOLEAN,
  ADD COLUMN IF NOT EXISTS inferred_reschedule_intent   BOOLEAN,
  ADD COLUMN IF NOT EXISTS inferred_crisis_risk         BOOLEAN,
  ADD COLUMN IF NOT EXISTS caller_sentiment_score       NUMERIC,
  ADD COLUMN IF NOT EXISTS hesitation_markers           JSONB,
  ADD COLUMN IF NOT EXISTS extracted_signals            JSONB,
  ADD COLUMN IF NOT EXISTS signals_extracted_at         TIMESTAMPTZ;

-- Today-screen / Needs-Attention queries hit "any unreviewed crisis flag
-- on a recent call". Partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS call_logs_crisis_risk_idx
  ON public.call_logs (practice_id, created_at DESC)
  WHERE inferred_crisis_risk = true;

-- No-show / reschedule predictors join on (patient_id, recent calls).
CREATE INDEX IF NOT EXISTS call_logs_inferred_intent_idx
  ON public.call_logs (practice_id, patient_id, created_at DESC)
  WHERE inferred_no_show_intent = true OR inferred_reschedule_intent = true;

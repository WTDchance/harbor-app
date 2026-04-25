-- ============================================================
-- TIER 2: LONGITUDINAL TRACKING TABLES
-- Three new tables for outcome measurement, communication
-- logging, and daily practice analytics.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 2A: PATIENT_ASSESSMENTS
-- Tracks standardized clinical scores (PHQ-9, GAD-7, PHQ-2,
-- GAD-2) over time. Links to patient for longitudinal trends.
-- Extends beyond outcome_assessments by adding patient_id FK,
-- individual response storage, and administration context.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patient_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_name TEXT,
  assessment_type TEXT NOT NULL,
    -- Values: phq2, gad2, phq9, gad7, phq2_gad2_phone, phq9_gad7_intake, custom
  score INTEGER,
  severity TEXT,
    -- Values: minimal, mild, moderate, moderately_severe, severe
  responses_json JSONB,
    -- Individual question answers, e.g. {"q1": 2, "q2": 3, ...}
  administered_by TEXT NOT NULL DEFAULT 'ai_call',
    -- Values: ai_call, intake_form, therapist, self_report
  call_log_id UUID,
    -- Link to the call where this was administered (if ai_call)
  intake_form_id UUID,
    -- Link to the intake form (if intake_form)
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_assessments_practice
  ON patient_assessments(practice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_assessments_patient
  ON patient_assessments(patient_id, assessment_type, created_at DESC)
  WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patient_assessments_type
  ON patient_assessments(practice_id, assessment_type);

COMMENT ON TABLE patient_assessments IS 'Longitudinal clinical assessment scores — the bridge between Harbor data and therapy outcomes';

-- ────────────────────────────────────────────────────────────
-- 2B: PATIENT_COMMUNICATIONS
-- Unified log of every touchpoint: calls, SMS, emails,
-- intake forms. Enables communication pattern analysis and
-- engagement scoring across all channels.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patient_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  patient_phone TEXT,
  patient_email TEXT,
  channel TEXT NOT NULL,
    -- Values: call, sms, email, intake_form
  direction TEXT NOT NULL DEFAULT 'inbound',
    -- Values: inbound, outbound
  content_summary TEXT,
    -- Short summary of the interaction (NOT the full transcript/body)
  sentiment_score FLOAT,
    -- Sentiment of this specific interaction (0.0-1.0)
  metadata_json JSONB DEFAULT '{}',
    -- Flexible: call_log_id, sms_sid, email_subject, intake_form_id, etc.
  duration_seconds INTEGER,
    -- For calls: call duration. For others: null.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_comms_practice_date
  ON patient_communications(practice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_comms_patient
  ON patient_communications(patient_id, created_at DESC)
  WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patient_comms_channel
  ON patient_communications(practice_id, channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_comms_phone
  ON patient_communications(practice_id, patient_phone);

COMMENT ON TABLE patient_communications IS 'Unified touchpoint log across all channels — enables engagement pattern analysis';

-- ────────────────────────────────────────────────────────────
-- 2C: PRACTICE_ANALYTICS
-- Pre-computed daily metrics per practice for fast dashboard
-- queries and trend analysis. One row per practice per day.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS practice_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  -- Call metrics
  total_calls INTEGER DEFAULT 0,
  new_patient_calls INTEGER DEFAULT 0,
  returning_patient_calls INTEGER DEFAULT 0,
  avg_call_duration_seconds FLOAT,
  avg_sentiment FLOAT,
  -- Booking metrics
  total_bookings INTEGER DEFAULT 0,
  booking_conversion_rate FLOAT,
    -- bookings / total_calls (only calls where booking was attempted)
  -- Intake metrics
  intakes_sent INTEGER DEFAULT 0,
  intakes_completed INTEGER DEFAULT 0,
  intake_completion_rate FLOAT,
  -- Appointment metrics
  total_appointments INTEGER DEFAULT 0,
  total_no_shows INTEGER DEFAULT 0,
  total_cancellations INTEGER DEFAULT 0,
  no_show_rate FLOAT,
  -- Patient metrics
  new_patients INTEGER DEFAULT 0,
  -- Topic breakdown (how many calls mentioned each topic)
  topic_counts_json JSONB DEFAULT '{}',
    -- e.g. {"anxiety": 5, "depression": 3, "scheduling": 12}
  -- Metadata
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(practice_id, date)
);

CREATE INDEX IF NOT EXISTS idx_practice_analytics_lookup
  ON practice_analytics(practice_id, date DESC);

COMMENT ON TABLE practice_analytics IS 'Daily rollup metrics per practice — powers dashboard analytics and trend detection';

-- ────────────────────────────────────────────────────────────
-- EXTEND outcome_assessments with patient_id FK
-- (existing table, safe additive change)
-- ────────────────────────────────────────────────────────────
ALTER TABLE outcome_assessments ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_outcome_assessments_patient
  ON outcome_assessments(patient_id) WHERE patient_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- RLS POLICIES
-- ────────────────────────────────────────────────────────────
ALTER TABLE patient_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_analytics ENABLE ROW LEVEL SECURITY;

-- patient_assessments: practice-scoped read + service role insert
CREATE POLICY "Users can read own practice assessments"
  ON patient_assessments FOR SELECT
  USING (practice_id = get_current_user_practice_id());
CREATE POLICY "Service role can insert assessments"
  ON patient_assessments FOR INSERT
  WITH CHECK (true);

-- patient_communications: practice-scoped read + service role insert
CREATE POLICY "Users can read own practice communications"
  ON patient_communications FOR SELECT
  USING (practice_id = get_current_user_practice_id());
CREATE POLICY "Service role can insert communications"
  ON patient_communications FOR INSERT
  WITH CHECK (true);

-- practice_analytics: practice-scoped read + service role insert/update
CREATE POLICY "Users can read own practice analytics"
  ON practice_analytics FOR SELECT
  USING (practice_id = get_current_user_practice_id());
CREATE POLICY "Service role can manage analytics"
  ON practice_analytics FOR ALL
  WITH CHECK (true);

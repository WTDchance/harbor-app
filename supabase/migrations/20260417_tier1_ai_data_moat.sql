-- ============================================================
-- TIER 1: AI DATA MOAT — Low-effort, high-signal schema additions
-- These columns enable transcript analysis, outcome tracking,
-- and predictive modeling without any new tables or services.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- CALL_LOGS: Per-call AI enrichment columns
-- ────────────────────────────────────────────────────────────

-- Sentiment & engagement (populated by post-call transcript analysis)
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS sentiment_score FLOAT;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS caller_engagement_score FLOAT;

-- Call disposition (populated at end-of-call)
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS call_outcome TEXT;
  -- Values: booked, message_taken, info_only, hung_up, voicemail, crisis_referral, no_interaction

-- New vs returning caller (populated at end-of-call)
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS is_new_patient BOOLEAN;

-- Booking attempt tracking (populated during tool calls)
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS booking_attempted BOOLEAN DEFAULT FALSE;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS booking_succeeded BOOLEAN DEFAULT FALSE;

-- Topic extraction (populated by post-call transcript analysis)
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS topics_discussed TEXT[];

-- Talk-time breakdown in seconds (populated by transcript parsing)
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS caller_talk_seconds INTEGER;
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS ai_talk_seconds INTEGER;

-- How many turns in the conversation (quick engagement proxy)
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS turn_count INTEGER;

-- Enrichment tracking
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

COMMENT ON COLUMN call_logs.sentiment_score IS 'AI-derived caller sentiment 0.0 (very negative) to 1.0 (very positive)';
COMMENT ON COLUMN call_logs.caller_engagement_score IS 'Caller engagement level 0.0 (disengaged) to 1.0 (highly engaged)';
COMMENT ON COLUMN call_logs.call_outcome IS 'Disposition: booked, message_taken, info_only, hung_up, voicemail, crisis_referral, no_interaction';
COMMENT ON COLUMN call_logs.is_new_patient IS 'True if this was the callers first call to this practice';
COMMENT ON COLUMN call_logs.booking_attempted IS 'Whether the AI attempted to check availability or book';
COMMENT ON COLUMN call_logs.booking_succeeded IS 'Whether a calendar event was actually created';
COMMENT ON COLUMN call_logs.topics_discussed IS 'Array of extracted topics: scheduling, insurance, crisis, anxiety, depression, etc.';
COMMENT ON COLUMN call_logs.caller_talk_seconds IS 'Estimated seconds the caller was speaking';
COMMENT ON COLUMN call_logs.ai_talk_seconds IS 'Estimated seconds the AI was speaking';
COMMENT ON COLUMN call_logs.turn_count IS 'Number of conversational turns (caller utterances)';
COMMENT ON COLUMN call_logs.enriched_at IS 'When post-call AI enrichment last ran on this record';

-- ────────────────────────────────────────────────────────────
-- APPOINTMENTS: Lifecycle tracking columns
-- (calendar_event_id and reminder_sent_at already exist)
-- ────────────────────────────────────────────────────────────

-- Confirmation tracking
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmation_method TEXT;
  -- Values: sms_reply, email_click, phone_call, manual

-- Cancellation detail
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- No-show tracking
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ;

-- Rescheduling chain
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS rescheduled_from UUID REFERENCES appointments(id);

-- How the appointment was created
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
  -- Values: ai_call, sms, web_intake, manual, admin

-- Predictive feature: hours between booking and appointment
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_lead_time_hours INTEGER;

COMMENT ON COLUMN appointments.confirmed_at IS 'When the patient confirmed (SMS reply, email click, etc.)';
COMMENT ON COLUMN appointments.confirmation_method IS 'How confirmed: sms_reply, email_click, phone_call, manual';
COMMENT ON COLUMN appointments.cancelled_at IS 'When cancelled — separate from status change for timing analysis';
COMMENT ON COLUMN appointments.cancellation_reason IS 'Free-text reason for cancellation — critical for no-show modeling';
COMMENT ON COLUMN appointments.no_show_at IS 'When marked as no-show';
COMMENT ON COLUMN appointments.rescheduled_from IS 'FK to original appointment if this is a reschedule';
COMMENT ON COLUMN appointments.source IS 'How booked: ai_call, sms, web_intake, manual, admin';
COMMENT ON COLUMN appointments.booking_lead_time_hours IS 'Hours between booking creation and appointment time — show rate predictor';

-- ────────────────────────────────────────────────────────────
-- PATIENTS: Aggregate & scoring columns
-- (date_of_birth may already exist from intake form)
-- ────────────────────────────────────────────────────────────

-- Running counters (updated by triggers or post-call code)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS total_calls INTEGER DEFAULT 0;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS total_appointments INTEGER DEFAULT 0;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS no_show_count INTEGER DEFAULT 0;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS cancellation_count INTEGER DEFAULT 0;

-- Recency markers
ALTER TABLE patients ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMPTZ;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS last_appointment_at TIMESTAMPTZ;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ;

-- Acquisition & source tracking
ALTER TABLE patients ADD COLUMN IF NOT EXISTS acquisition_source TEXT;
  -- Values: ai_call, referral, website, directory, social_media, other

-- AI-computed scores (populated by enrichment cron, Tier 3)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS risk_score FLOAT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS engagement_score FLOAT;

-- DOB (if not already added by intake migration)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS date_of_birth DATE;

COMMENT ON COLUMN patients.total_calls IS 'Running count of calls from this patient';
COMMENT ON COLUMN patients.total_appointments IS 'Running count of appointments (all statuses)';
COMMENT ON COLUMN patients.no_show_count IS 'Running count of no-shows — risk flag';
COMMENT ON COLUMN patients.cancellation_count IS 'Running count of cancellations';
COMMENT ON COLUMN patients.last_call_at IS 'Most recent call timestamp';
COMMENT ON COLUMN patients.last_appointment_at IS 'Most recent appointment timestamp';
COMMENT ON COLUMN patients.first_contact_at IS 'When the patient first contacted the practice';
COMMENT ON COLUMN patients.acquisition_source IS 'How they found the practice: ai_call, referral, website, etc.';
COMMENT ON COLUMN patients.risk_score IS 'AI-computed no-show/dropout risk 0.0 to 1.0 (Tier 3)';
COMMENT ON COLUMN patients.engagement_score IS 'AI-computed engagement level 0.0 to 1.0 (Tier 3)';
COMMENT ON COLUMN patients.date_of_birth IS 'Patient DOB from intake form demographics';

-- ────────────────────────────────────────────────────────────
-- INDEXES for the new columns
-- ────────────────────────────────────────────────────────────

-- Call outcome analysis
CREATE INDEX IF NOT EXISTS idx_call_logs_outcome
  ON call_logs(practice_id, call_outcome)
  WHERE call_outcome IS NOT NULL;

-- Unenriched calls (for the enrichment cron to pick up)
CREATE INDEX IF NOT EXISTS idx_call_logs_unenriched
  ON call_logs(created_at)
  WHERE enriched_at IS NULL AND transcript IS NOT NULL;

-- Appointment lifecycle queries
CREATE INDEX IF NOT EXISTS idx_appointments_source
  ON appointments(practice_id, source);

CREATE INDEX IF NOT EXISTS idx_appointments_no_show
  ON appointments(practice_id, no_show_at)
  WHERE no_show_at IS NOT NULL;

-- Patient risk scoring
CREATE INDEX IF NOT EXISTS idx_patients_risk_score
  ON patients(practice_id, risk_score DESC)
  WHERE risk_score IS NOT NULL;

-- Patient engagement
CREATE INDEX IF NOT EXISTS idx_patients_engagement
  ON patients(practice_id, engagement_score DESC)
  WHERE engagement_score IS NOT NULL;

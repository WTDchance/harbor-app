-- Migration: Scheduling modes, DOB verification, calendar token, daily recap
-- Date: 2026-04-11
-- Description: Adds scheduling mode toggle, DOB to patients, calendar subscription token,
--              schedule change tracking, and daily recap preferences.

-- ============================================================
-- 1. practices: scheduling_mode, daily_recap, calendar_token, notification_emails
-- ============================================================
ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS scheduling_mode TEXT NOT NULL DEFAULT 'notification'
    CHECK (scheduling_mode IN ('harbor_driven', 'notification')),
  ADD COLUMN IF NOT EXISTS daily_recap_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_recap_time TIME NOT NULL DEFAULT '19:00',
  ADD COLUMN IF NOT EXISTS daily_recap_method TEXT NOT NULL DEFAULT 'email'
    CHECK (daily_recap_method IN ('email', 'sms', 'both')),
  ADD COLUMN IF NOT EXISTS calendar_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS notification_emails TEXT[];

-- ============================================================
-- 2. patients: date_of_birth (HIPAA identity verification)
-- ============================================================
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

COMMENT ON COLUMN patients.date_of_birth IS 'Used for HIPAA identity verification before schedule changes';

-- ============================================================
-- 3. schedule_changes: track every appointment modification
-- ============================================================
CREATE TABLE IF NOT EXISTS schedule_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'rescheduled', 'cancelled', 'confirmed', 'reverted')),
  previous_time TIMESTAMPTZ,
  new_time TIMESTAMPTZ,
  requested_by TEXT NOT NULL CHECK (requested_by IN ('patient', 'therapist', 'system')),
  dob_verified BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'reverted', 'auto_confirmed')),
  confirmed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '2 hours'),
  notes TEXT,
  included_in_recap BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS on schedule_changes
ALTER TABLE schedule_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY schedule_changes_practice_isolation ON schedule_changes
  FOR ALL
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()))
  WITH CHECK (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

-- Index for daily recap queries
CREATE INDEX IF NOT EXISTS idx_schedule_changes_practice_date
  ON schedule_changes (practice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_schedule_changes_recap
  ON schedule_changes (practice_id, included_in_recap)
  WHERE included_in_recap = false;

-- ============================================================
-- 4. daily_recaps: log of sent recaps
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_recaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_method TEXT NOT NULL CHECK (delivery_method IN ('email', 'sms', 'both')),
  changes_count INTEGER NOT NULL DEFAULT 0,
  tomorrow_count INTEGER NOT NULL DEFAULT 0,
  recap_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE daily_recaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_recaps_practice_isolation ON daily_recaps
  FOR ALL
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()))
  WITH CHECK (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

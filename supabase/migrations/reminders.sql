-- Harbor Appointment Reminders Migration
-- Table for tracking appointment reminders sent to patients

CREATE TABLE IF NOT EXISTS appointment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  patient_phone TEXT NOT NULL,
  patient_name TEXT,
  appointment_time TIMESTAMPTZ,
  session_type TEXT DEFAULT 'in-person',
  twilio_sid TEXT,
  status TEXT DEFAULT 'sent',
  reply TEXT,
  reply_received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_reminders_practice ON appointment_reminders(practice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON appointment_reminders(practice_id, status);
CREATE INDEX IF NOT EXISTS idx_reminders_appointment_time ON appointment_reminders(appointment_time);

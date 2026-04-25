CREATE TABLE IF NOT EXISTS patient_arrivals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
  patient_phone TEXT NOT NULL,
  patient_name TEXT,
  appointment_time TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ DEFAULT NOW(),
  therapist_notified BOOLEAN DEFAULT false,
  therapist_notification_sid TEXT
);

CREATE INDEX IF NOT EXISTS idx_arrivals_practice_date ON patient_arrivals(practice_id, arrived_at DESC);
CREATE INDEX IF NOT EXISTS idx_arrivals_phone ON patient_arrivals(patient_phone, arrived_at DESC);

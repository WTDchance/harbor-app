-- TheraLink Supabase Schema
-- Run this SQL in your Supabase dashboard: SQL Editor > New Query

-- Enable RLS (Row Level Security)
ALTER DATABASE postgres SET "app.settings.jwt_secret" = 'your-jwt-secret';

-- ============================================================================
-- PRACTICES TABLE
-- Multi-tenant core: each therapy practice is a practice row
-- ============================================================================
CREATE TABLE practices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  ai_name TEXT NOT NULL DEFAULT 'Receptionist',
  phone_number TEXT NOT NULL UNIQUE,
  hours_json JSONB NOT NULL DEFAULT '{
    "monday": {"enabled": true, "openTime": "09:00", "closeTime": "17:00"},
    "tuesday": {"enabled": true, "openTime": "09:00", "closeTime": "17:00"},
    "wednesday": {"enabled": true, "openTime": "09:00", "closeTime": "17:00"},
    "thursday": {"enabled": true, "openTime": "09:00", "closeTime": "17:00"},
    "friday": {"enabled": true, "openTime": "09:00", "closeTime": "17:00"},
    "saturday": {"enabled": false},
    "sunday": {"enabled": false}
  }'::JSONB,
  insurance_accepted TEXT[] DEFAULT ARRAY[]::TEXT[],
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- USERS TABLE
-- Admin/staff users for each practice
-- ============================================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- PATIENTS TABLE
-- New and returning patients who call/text the practice
-- ============================================================================
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  insurance TEXT,
  reason_for_seeking TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Composite index for finding patients by practice and phone
CREATE INDEX idx_patients_practice_phone ON patients(practice_id, phone);

-- ============================================================================
-- APPOINTMENTS TABLE
-- Scheduled therapy sessions
-- ============================================================================
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no-show')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for finding upcoming appointments
CREATE INDEX idx_appointments_practice_status ON appointments(practice_id, status, scheduled_at);

-- ============================================================================
-- CALL_LOGS TABLE
-- Records of all incoming/outgoing calls via Vapi
-- ============================================================================
CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  patient_phone TEXT NOT NULL,
  duration_seconds INTEGER,
  transcript TEXT,
  summary TEXT,
  vapi_call_id TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for finding calls by practice
CREATE INDEX idx_call_logs_practice_date ON call_logs(practice_id, created_at DESC);

-- ============================================================================
-- SMS_CONVERSATIONS TABLE
-- SMS conversation threads with patients
-- ============================================================================
CREATE TABLE sms_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  patient_phone TEXT NOT NULL,
  messages_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for finding conversations
CREATE INDEX idx_sms_conversations_practice_phone ON sms_conversations(practice_id, patient_phone);
CREATE INDEX idx_sms_conversations_practice_date ON sms_conversations(practice_id, last_message_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Ensure users can only access their practice's data
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_conversations ENABLE ROW LEVEL SECURITY;

-- Create a helper function to get current user's practice_id from JWT
CREATE OR REPLACE FUNCTION get_current_user_practice_id()
RETURNS UUID AS $$
BEGIN
  RETURN COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID,
    NULL
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Practices: Users can read their own practice
CREATE POLICY "Users can read own practice"
  ON practices FOR SELECT
  USING (id = get_current_user_practice_id());

-- Users: Users can read users from their practice
CREATE POLICY "Users can read own practice users"
  ON users FOR SELECT
  USING (practice_id = get_current_user_practice_id());

-- Patients: Users can read/write patients from their practice
CREATE POLICY "Users can read own practice patients"
  ON patients FOR SELECT
  USING (practice_id = get_current_user_practice_id());

CREATE POLICY "Users can insert patients for own practice"
  ON patients FOR INSERT
  WITH CHECK (practice_id = get_current_user_practice_id());

CREATE POLICY "Users can update own practice patients"
  ON patients FOR UPDATE
  USING (practice_id = get_current_user_practice_id());

-- Appointments: Full CRUD within practice
CREATE POLICY "Users can read own practice appointments"
  ON appointments FOR SELECT
  USING (practice_id = get_current_user_practice_id());

CREATE POLICY "Users can create appointments for own practice"
  ON appointments FOR INSERT
  WITH CHECK (practice_id = get_current_user_practice_id());

CREATE POLICY "Users can update own practice appointments"
  ON appointments FOR UPDATE
  USING (practice_id = get_current_user_practice_id());

-- Call Logs: Users can read their practice's calls
CREATE POLICY "Users can read own practice call logs"
  ON call_logs FOR SELECT
  USING (practice_id = get_current_user_practice_id());

CREATE POLICY "Service role can insert call logs"
  ON call_logs FOR INSERT
  WITH CHECK (true); -- Service role bypass

-- SMS Conversations: Users can read their practice's conversations
CREATE POLICY "Users can read own practice sms conversations"
  ON sms_conversations FOR SELECT
  USING (practice_id = get_current_user_practice_id());

CREATE POLICY "Users can update own practice sms conversations"
  ON sms_conversations FOR UPDATE
  USING (practice_id = get_current_user_practice_id());

CREATE POLICY "Service role can insert sms conversations"
  ON sms_conversations FOR INSERT
  WITH CHECK (true); -- Service role bypass

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================
CREATE INDEX idx_users_practice_id ON users(practice_id);
CREATE INDEX idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX idx_patients_created_at ON patients(created_at DESC);

-- ============================================================================
-- NOTES FOR IMPLEMENTATION
-- ============================================================================
-- 1. When a practice signs up, insert a row in practices table
-- 2. When a user logs in, set their JWT app_metadata.practice_id
-- 3. All queries use service_role key on backend with practice_id filtering
-- 4. Frontend uses anon key, which enforces RLS automatically
-- 5. Vapi/Twilio webhooks use service_role key to insert logs

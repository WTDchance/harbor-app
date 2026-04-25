-- ============================================================================
-- Therapist Onboarding Profile
-- Rich practice data collected during onboarding so the AI receptionist
-- sounds like they actually know the practice.
-- ============================================================================

-- Single JSONB column keeps the schema flexible as we add questions.
-- Individual columns for the most critical fields that server.ts reads directly.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS onboarding_profile JSONB DEFAULT '{}'::JSONB;

-- Key fields that the voice prompt uses directly
ALTER TABLE practices ADD COLUMN IF NOT EXISTS therapist_title TEXT;           -- e.g. "Dr.", "Licensed Counselor"
ALTER TABLE practices ADD COLUMN IF NOT EXISTS therapist_pronouns TEXT;        -- e.g. "she/her"
ALTER TABLE practices ADD COLUMN IF NOT EXISTS practice_vibe TEXT;             -- e.g. "warm and casual", "professional"
ALTER TABLE practices ADD COLUMN IF NOT EXISTS session_length_minutes INTEGER DEFAULT 50;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS booking_lead_days INTEGER;      -- how far out they're typically booked
ALTER TABLE practices ADD COLUMN IF NOT EXISTS new_patient_callback_time TEXT; -- e.g. "within one business day"
ALTER TABLE practices ADD COLUMN IF NOT EXISTS evening_weekend_available BOOLEAN DEFAULT false;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS sliding_scale BOOLEAN DEFAULT false;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS intake_process_notes TEXT;      -- what happens at first appointment
ALTER TABLE practices ADD COLUMN IF NOT EXISTS parking_notes TEXT;             -- parking/building access info
ALTER TABLE practices ADD COLUMN IF NOT EXISTS populations_served TEXT[];      -- e.g. {"adults", "couples", "teens"}
ALTER TABLE practices ADD COLUMN IF NOT EXISTS modalities TEXT[];              -- e.g. {"CBT", "EMDR", "psychodynamic"}
ALTER TABLE practices ADD COLUMN IF NOT EXISTS languages TEXT[] DEFAULT ARRAY['English']::TEXT[];
ALTER TABLE practices ADD COLUMN IF NOT EXISTS receptionist_personality TEXT;  -- e.g. "warm and friendly", "calm and professional"
ALTER TABLE practices ADD COLUMN IF NOT EXISTS after_hours_emergency TEXT;     -- emergency instructions outside hours
ALTER TABLE practices ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS location TEXT;                  -- human-readable location string
ALTER TABLE practices ADD COLUMN IF NOT EXISTS provider_name TEXT;             -- therapist's full name
ALTER TABLE practices ADD COLUMN IF NOT EXISTS specialties TEXT[];
ALTER TABLE practices ADD COLUMN IF NOT EXISTS telehealth_available BOOLEAN DEFAULT true;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS cancellation_policy TEXT;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS accepting_new_patients BOOLEAN DEFAULT true;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS waitlist_enabled BOOLEAN DEFAULT false;

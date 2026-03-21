-- Harbor Group Practice Support Migration
-- Support for multi-therapist practices

-- Add group practice fields to practices table
ALTER TABLE practices ADD COLUMN IF NOT EXISTS is_group_practice BOOLEAN DEFAULT false;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS parent_practice_id UUID REFERENCES practices(id);

-- Create practice_members table for therapists in a practice
CREATE TABLE IF NOT EXISTS practice_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  therapist_name TEXT NOT NULL,
  therapist_email TEXT,
  therapist_phone TEXT,
  vapi_assistant_id TEXT,
  specialties TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_practice_members_practice ON practice_members(practice_id);
CREATE INDEX IF NOT EXISTS idx_practice_members_email ON practice_members(therapist_email);
CREATE INDEX IF NOT EXISTS idx_practice_members_active ON practice_members(practice_id, is_active) WHERE is_active = true;

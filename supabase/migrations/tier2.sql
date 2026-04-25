-- Harbor Tier 2 Migration
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/oubmpjtbbobiuzumagec/sql

-- Crisis alerts enhancements
ALTER TABLE crisis_alerts ADD COLUMN IF NOT EXISTS reviewed BOOLEAN DEFAULT false;
ALTER TABLE crisis_alerts ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Waitlist enhancements for cancellation fill flow
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS fill_offered_at TIMESTAMPTZ;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS offered_slot TIMESTAMPTZ;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS claimed_slot_at TIMESTAMPTZ;

-- Onboarding tracking
CREATE TABLE IF NOT EXISTS onboarding_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'web',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for crisis alerts reviewed status
CREATE INDEX IF NOT EXISTS idx_crisis_alerts_reviewed ON crisis_alerts(practice_id, reviewed) WHERE reviewed = false;

-- Index for waitlist fill offers
CREATE INDEX IF NOT EXISTS idx_waitlist_fill_offered ON waitlist(practice_id, status) WHERE status = 'fill_offered';

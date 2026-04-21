-- Crisis resources + is_crisis_capable.
-- Ellie reads these resources to callers in crisis, in order. When
-- practices.is_crisis_capable = false (default), she routes to 988 + this
-- list and does NOT promise therapist follow-up.

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS is_crisis_capable BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS practice_crisis_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  text_line TEXT,
  description TEXT,
  coverage_area TEXT,
  availability TEXT,
  url TEXT,
  is_primary BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crisis_resources_practice
  ON practice_crisis_resources(practice_id) WHERE active = true;

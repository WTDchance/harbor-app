-- Add emotional support mode toggle to practices
ALTER TABLE practices ADD COLUMN IF NOT EXISTS emotional_support_enabled BOOLEAN DEFAULT TRUE;

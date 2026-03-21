-- Add note_format column to session_notes table
-- Tracks which clinical format was used (soap, dap, birp, progress, raw)
ALTER TABLE session_notes ADD COLUMN IF NOT EXISTS note_format TEXT DEFAULT 'raw';

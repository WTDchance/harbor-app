-- Fax number on practices: used when callers request ROI (Release of Information) by fax.
-- Surfaced in Ellie's system prompt so she can speak it aloud when asked.
-- Applied to prod via direct Supabase connection on 2026-04-20.
ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS fax_number TEXT;

COMMENT ON COLUMN practices.fax_number IS
  'Fax number for the practice, used when callers request fax-based ROI or other paperwork. Human-readable phone format.';

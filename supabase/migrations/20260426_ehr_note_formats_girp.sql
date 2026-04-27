-- Wave 36+ Tier-1 push (T2.1) — extend note_format options.
--
-- Adds 'girp' (Goal/Intervention/Response/Plan) to the accepted set and
-- introduces patients.preferred_note_format so the editor can default to
-- a therapist's per-patient choice.
--
-- 'narrative' is intentionally NOT added as a new value; the existing
-- 'freeform' value is the storage shape for prose and only its UI label
-- changes ("Narrative"). This avoids splitting prose notes across two
-- equivalent enum values for a cosmetic rename.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.constraint_column_usage
     WHERE table_schema = 'public'
       AND table_name = 'ehr_progress_notes'
       AND column_name = 'note_format'
  ) THEN
    ALTER TABLE public.ehr_progress_notes
      DROP CONSTRAINT IF EXISTS ehr_progress_notes_note_format_check;
  END IF;
END $$;

ALTER TABLE public.ehr_progress_notes
  ADD CONSTRAINT ehr_progress_notes_note_format_check
  CHECK (note_format IN ('soap', 'dap', 'birp', 'girp', 'freeform'));

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS preferred_note_format TEXT
    CHECK (preferred_note_format IN ('soap', 'dap', 'birp', 'girp', 'freeform'));

COMMENT ON COLUMN public.patients.preferred_note_format IS
  'Therapist''s preferred note layout for this patient. Used to seed the format picker on /dashboard/ehr/notes/new. NULL means no preference (UI falls back to soap).';

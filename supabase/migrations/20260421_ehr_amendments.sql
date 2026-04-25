-- Amendments: a therapist can amend a signed note by creating a new note
-- that links back to the original. The original stays signed and immutable;
-- the amendment is its own signable row. This preserves the audit trail of
-- "what was first documented" vs "what was clarified later."
--
-- The 'amended' status is used on the new row after it's signed; the
-- ORIGINAL row keeps status='signed' (it was never updated). The chain
-- is reconstructable via amendment_of pointing at the predecessor.

ALTER TABLE public.ehr_progress_notes
  ADD COLUMN IF NOT EXISTS amendment_of UUID
    REFERENCES public.ehr_progress_notes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ehr_progress_notes.amendment_of IS
  'When not null, this note amends the referenced note. The referenced note '
  'keeps status=''signed'' (immutable); this row progresses through draft '
  '-> amended as the therapist edits and signs the amendment.';

CREATE INDEX IF NOT EXISTS idx_ehr_notes_amendment_of
  ON public.ehr_progress_notes (amendment_of)
  WHERE amendment_of IS NOT NULL;

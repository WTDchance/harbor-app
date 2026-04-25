-- Track the source call when a progress note was drafted by AI from a transcript.
-- NULLABLE — notes created manually don't have a source call.

ALTER TABLE public.ehr_progress_notes
  ADD COLUMN IF NOT EXISTS drafted_from_call_id UUID
    REFERENCES public.call_logs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ehr_progress_notes.drafted_from_call_id IS
  'When not null, this note was initially drafted by Claude Sonnet from '
  'the referenced call_logs row. Editing the note after drafting does not '
  'clear this link — it preserves provenance for audit.';

CREATE INDEX IF NOT EXISTS idx_ehr_notes_drafted_from_call
  ON public.ehr_progress_notes (drafted_from_call_id)
  WHERE drafted_from_call_id IS NOT NULL;

-- Week 4 second pass: supervision / co-signing.

-- Supervision relationships: supervisor -> supervisee.
CREATE TABLE IF NOT EXISTS public.ehr_supervision (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  supervisor_id   UUID NOT NULL REFERENCES public.therapists(id) ON DELETE CASCADE,
  supervisee_id   UUID NOT NULL REFERENCES public.therapists(id) ON DELETE CASCADE,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  started_at      DATE NOT NULL DEFAULT CURRENT_DATE,
  ended_at        DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_supervision CHECK (supervisor_id <> supervisee_id),
  UNIQUE (supervisor_id, supervisee_id, started_at)
);

CREATE INDEX IF NOT EXISTS idx_ehr_supervision_practice
  ON public.ehr_supervision (practice_id, is_active);

ALTER TABLE public.ehr_supervision ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ehr_supervision_select ON public.ehr_supervision;
CREATE POLICY ehr_supervision_select ON public.ehr_supervision FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Co-signing columns on progress notes
ALTER TABLE public.ehr_progress_notes
  ADD COLUMN IF NOT EXISTS requires_cosign BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cosigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cosigned_by UUID,
  ADD COLUMN IF NOT EXISTS cosign_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_ehr_notes_pending_cosign
  ON public.ehr_progress_notes (practice_id, requires_cosign, cosigned_at)
  WHERE requires_cosign = true AND cosigned_at IS NULL;

COMMENT ON COLUMN public.ehr_progress_notes.requires_cosign IS
  'Set true on creation when the note author is an associate under supervision. '
  'After the author signs, the note stays in status=signed but appears in the '
  'supervisor''s co-sign queue until cosigned_at is set.';

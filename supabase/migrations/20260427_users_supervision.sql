-- Wave 38 / TS9 — supervisor cosign for unlicensed clinicians.
--
-- Adds the user-level supervision relationship that the existing cosign
-- route (app/api/ehr/notes/[id]/cosign/route.ts) needed. The route was
-- previously gated behind an admin email override because the schema did
-- not surface the supervisor user. After this migration the supervisor
-- check resolves through users.supervisor_user_id directly.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS license_type TEXT,                    -- LCSW, LPC, LMFT, PsyD, intern, etc.
  ADD COLUMN IF NOT EXISTS requires_supervision BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supervisor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.users.license_type IS
  'Clinical license abbreviation (LCSW, LPC, LMFT, etc.) or "intern" / "associate" '
  'for unlicensed clinicians. Independent of the therapists.license_type column '
  'because user identity (auth principal) and therapist identity (clinical record) '
  'are not 1:1 — front-desk staff are users without therapist rows.';

COMMENT ON COLUMN public.users.requires_supervision IS
  'When true, every clinical note this user signs lands in the supervisor''s '
  'cosign queue with cosign_status=pending until their supervisor cosigns.';

COMMENT ON COLUMN public.users.supervisor_user_id IS
  'The user.id of this user''s designated cosigning supervisor. NULL means no '
  'supervisor configured — notes by a requires_supervision=true user with NULL '
  'supervisor are still flagged for cosign but have no auto-routing target.';

-- Self-supervision is invalid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.users'::regclass
       AND conname = 'users_no_self_supervision'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_no_self_supervision
      CHECK (supervisor_user_id IS NULL OR supervisor_user_id <> id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_users_supervisor
  ON public.users (supervisor_user_id)
  WHERE supervisor_user_id IS NOT NULL;

-- Cosign-status column on progress notes for explicit state tracking.
-- The existing requires_cosign + cosigned_at columns already capture the
-- queue state implicitly; this exposes it as an enum-like field for the
-- queue UI to filter on.
ALTER TABLE public.ehr_progress_notes
  ADD COLUMN IF NOT EXISTS cosign_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (cosign_status IN ('not_required', 'pending', 'cosigned'));

-- Backfill: any row with requires_cosign=true and cosigned_at IS NULL is pending.
UPDATE public.ehr_progress_notes
   SET cosign_status = CASE
     WHEN cosigned_at IS NOT NULL THEN 'cosigned'
     WHEN requires_cosign = true THEN 'pending'
     ELSE 'not_required'
   END
 WHERE cosign_status = 'not_required'
   AND (requires_cosign = true OR cosigned_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_ehr_notes_cosign_status
  ON public.ehr_progress_notes (practice_id, cosign_status, created_at DESC)
  WHERE cosign_status = 'pending';

COMMENT ON COLUMN public.ehr_progress_notes.cosign_status IS
  'Explicit cosign workflow state. not_required when the author is fully '
  'licensed; pending after the author signs and before the supervisor cosigns; '
  'cosigned after supervisor approval. Maintained by the cosign API route.';

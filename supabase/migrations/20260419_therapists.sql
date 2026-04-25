-- Therapists table (2026-04-19)
--
-- Each practice can have one or more therapists. Today most practices are solo
-- (one therapist = the practice owner), but we're building multi-therapist from
-- day one so group practices work without a schema migration later.
--
-- The bio field is what Ellie references when a caller asks about the therapist
-- ("what's Dr. Trace like?", "does she work with couples?"). Soft-capped at ~1500
-- chars in the UI; no hard DB cap — PostgreSQL TEXT is fine.
--
-- practices.provider_name stays in place as a fallback for any legacy code path
-- that hasn't migrated to the new table yet. New UI + system prompt reads from
-- therapists; old code paths can still read provider_name until they're updated.

CREATE TABLE IF NOT EXISTS therapists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,

  display_name TEXT NOT NULL,                 -- e.g. "Dr. Trace Wonser"
  credentials TEXT,                           -- e.g. "LCSW", "PhD", "LMFT"
  bio TEXT,                                   -- free-form, soft-capped at 1500 chars in UI

  is_primary BOOLEAN NOT NULL DEFAULT false,  -- marks the principal therapist for solo practices
  is_active BOOLEAN NOT NULL DEFAULT true,    -- soft delete / leave-of-absence

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE therapists IS
  'Clinicians who practice under a given Harbor practice. Each practice has >=1 therapist after backfill. Ellie uses display_name + credentials + bio to talk about the therapist(s) on calls.';
COMMENT ON COLUMN therapists.is_primary IS
  'One therapist per practice should be flagged primary. Used when Ellie needs to refer to "the therapist" in the singular (solo-practice phrasing, fallbacks, post-call emails).';
COMMENT ON COLUMN therapists.is_active IS
  'Set false to hide the therapist from the active roster without deleting history (leave-of-absence, retired, left the practice). Inactive therapists are NOT referenced by Ellie.';

-- Hot path: "list active therapists for this practice" runs on every
-- assistant-request and every settings load.
CREATE INDEX IF NOT EXISTS idx_therapists_practice_active
  ON therapists(practice_id, is_active);

-- At most one primary per practice. Partial unique index so inactive rows can
-- still have is_primary=true (preserves history without blocking a new primary).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_therapists_one_primary_per_practice
  ON therapists(practice_id)
  WHERE is_primary = true AND is_active = true;

-- Row-level security: scope to the practice the authenticated user belongs to.
-- (Harbor uses supabaseAdmin for most writes; RLS is defence-in-depth.)
ALTER TABLE therapists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own practice therapists"
  ON therapists FOR SELECT
  USING (practice_id IN (SELECT practice_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can insert therapists for own practice"
  ON therapists FOR INSERT
  WITH CHECK (practice_id IN (SELECT practice_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update own practice therapists"
  ON therapists FOR UPDATE
  USING (practice_id IN (SELECT practice_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can delete own practice therapists"
  ON therapists FOR DELETE
  USING (practice_id IN (SELECT practice_id FROM users WHERE id = auth.uid()));

-- Backfill: one therapist row per practice that has a non-null provider_name.
-- Practices with null provider_name start empty; the settings UI will prompt
-- the owner to add a therapist the next time they load it.
INSERT INTO therapists (practice_id, display_name, is_primary, is_active)
SELECT id, provider_name, true, true
FROM practices
WHERE provider_name IS NOT NULL
  AND provider_name <> ''
  AND NOT EXISTS (
    SELECT 1 FROM therapists t WHERE t.practice_id = practices.id
  );

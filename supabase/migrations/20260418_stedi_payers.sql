-- Stedi payer directory (2026-04-18)
-- Local mirror of Stedi's full payer network (~3600 payers).
-- Populated by /api/cron/sync-stedi-payers which calls the Stedi Payers API
-- and upserts all records. Lets resolvePayerId() match any insurance company
-- name a patient provides — not just the ~20 we hardcoded at launch.
--
-- The table is intentionally denormalized: aliases and names are stored as
-- JSONB arrays for fast GIN-indexed search, and operating_states as a text
-- array for && (overlap) queries.

CREATE TABLE IF NOT EXISTS stedi_payers (
  stedi_id text PRIMARY KEY,                    -- e.g. 'JZSAE'
  display_name text NOT NULL,                    -- e.g. 'Cascade Health Alliance'
  primary_payer_id text,                         -- e.g. 'CHA01' (clearinghouse ID)
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,    -- array of alternate payer IDs
  names jsonb NOT NULL DEFAULT '[]'::jsonb,      -- array of alternate display names
  eligibility_supported boolean NOT NULL DEFAULT false,
  claim_submission_supported boolean NOT NULL DEFAULT false,
  claim_status_supported boolean NOT NULL DEFAULT false,
  operating_states text[] NOT NULL DEFAULT '{}', -- e.g. {'OR','WA'}
  raw_transaction_support jsonb,                 -- full transactionSupport object
  avatar_url text,
  website_url text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- GIN indexes for fast text search across aliases and names
CREATE INDEX IF NOT EXISTS idx_stedi_payers_aliases ON stedi_payers USING gin (aliases);
CREATE INDEX IF NOT EXISTS idx_stedi_payers_names ON stedi_payers USING gin (names);
CREATE INDEX IF NOT EXISTS idx_stedi_payers_states ON stedi_payers USING gin (operating_states);
CREATE INDEX IF NOT EXISTS idx_stedi_payers_display_name ON stedi_payers USING gin (display_name gin_trgm_ops);

-- Filtered index: only payers that support eligibility (the ones we actually query)
CREATE INDEX IF NOT EXISTS idx_stedi_payers_elig ON stedi_payers (stedi_id)
  WHERE eligibility_supported = true;

-- Text search index for fuzzy matching on display_name + names
-- Requires pg_trgm which Supabase enables by default
CREATE INDEX IF NOT EXISTS idx_stedi_payers_display_trgm
  ON stedi_payers USING gin (lower(display_name) gin_trgm_ops);

ALTER TABLE stedi_payers ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read payer directory (it's public reference data)
DROP POLICY IF EXISTS "Authenticated users can read payer directory" ON stedi_payers;
CREATE POLICY "Authenticated users can read payer directory"
  ON stedi_payers FOR SELECT
  USING (auth.role() = 'authenticated');

-- Service role (used by sync endpoint) has full access via bypassing RLS

COMMENT ON TABLE stedi_payers IS
  'Mirror of Stedi payer network. Synced by /api/cron/sync-stedi-payers. Used by resolvePayerId() to match patient insurance to Stedi trading partner ID.';

-- Fuzzy match function for resolvePayerIdWithDb()
-- Uses pg_trgm similarity to find closest display_name match among
-- eligibility-supported payers.
CREATE OR REPLACE FUNCTION match_stedi_payer(search_term text)
RETURNS TABLE(stedi_id text, display_name text, similarity_score real)
LANGUAGE sql STABLE
AS $$
  SELECT
    sp.stedi_id,
    sp.display_name,
    similarity(lower(sp.display_name), search_term) AS similarity_score
  FROM stedi_payers sp
  WHERE sp.eligibility_supported = true
    AND similarity(lower(sp.display_name), search_term) > 0.25
  ORDER BY similarity_score DESC
  LIMIT 1;
$$;

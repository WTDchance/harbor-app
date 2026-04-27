-- Harbor — Practice decommission migration
-- Adds the columns used by /api/admin/practices/[id]/decommission so the
-- "Decommission" admin button can mark a practice as decommissioned without
-- hard-deleting any PHI (see CODEOWNERS rule on /app/api/admin/).
--
-- Run in Supabase SQL editor against the staging RDS first:
--   https://supabase.com/dashboard/project/<ref>/sql
--
-- Idempotent — safe to re-run.

-- 1. Track when a practice was decommissioned (separate from deleted_at,
--    which is reserved for hard-delete). Decommissioned practices stay
--    queryable for export, audit, and back-office reconciliation.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS decommissioned_at  TIMESTAMPTZ;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS decommissioned_by  TEXT; -- actor email for the audit trail

-- 2. Mark individual users on a decommissioned practice as inactive so they
--    can't log in and accidentally see partially-torn-down state. The brief
--    explicitly asked for this; we keep the row instead of deleting it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active) WHERE is_active = FALSE;

-- 3. Backfill — every existing practice and user is active until we say
--    otherwise. (No-op for new tables; meaningful when migration runs against
--    an existing cluster.)
UPDATE users SET is_active = TRUE WHERE is_active IS NULL;

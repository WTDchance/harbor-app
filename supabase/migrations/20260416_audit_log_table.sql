-- ==========================================================================
-- HIPAA Audit Log Table (§164.312(b))
-- Tracks all authentication events, PHI access, and admin actions.
-- Immutable: no UPDATE or DELETE policies for authenticated users.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Who
  user_id UUID REFERENCES auth.users(id),
  user_email TEXT,
  practice_id UUID REFERENCES practices(id),

  -- What
  action TEXT NOT NULL,
  -- e.g. 'login', 'logout', 'session_timeout', 'password_reset',
  --      'patient_view', 'patient_update', 'call_log_view',
  --      'admin_impersonate', 'settings_change', 'export_data'

  resource_type TEXT,        -- e.g. 'patient', 'call_log', 'appointment', 'practice'
  resource_id TEXT,          -- PK of the accessed resource

  -- Context
  details JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,

  -- Indexing
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical'))
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_practice_id ON audit_logs(practice_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity) WHERE severity != 'info';

-- RLS: service role writes, practice users can only SELECT their own
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Practice users can read their own audit logs
DROP POLICY IF EXISTS "practice_read_audit_logs" ON audit_logs;
CREATE POLICY "practice_read_audit_logs"
  ON audit_logs FOR SELECT
  USING (practice_id = get_current_user_practice_id());

-- No INSERT/UPDATE/DELETE for authenticated users —
-- only service role (supabaseAdmin) writes audit logs.
-- This makes the audit trail tamper-resistant.

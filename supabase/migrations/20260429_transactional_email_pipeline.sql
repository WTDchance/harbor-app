-- Wave 50 — SES transactional email pipeline.
--
-- Three new tables:
--   1. ses_suppression_list   — hard bounces, complaints, manual blocks
--   2. email_send_log         — per-send delivery tracking
--   3. user_notification_preferences columns on users + patients
--
-- Plus a soft-bounce counter on patients/users so soft bounces only
-- escalate after 3 failures in 30 days. RLS is per-practice for tenant
-- isolation; service-role bypasses for the webhook handler.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Suppression list
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ses_suppression_list (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('hard_bounce', 'complaint', 'manual', 'invalid_format')),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_message_id TEXT,
  practice_id   UUID REFERENCES practices(id) ON DELETE CASCADE,
  notes         TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ses_suppression_email_practice
  ON ses_suppression_list(LOWER(email), COALESCE(practice_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_ses_suppression_email
  ON ses_suppression_list(LOWER(email));

CREATE INDEX IF NOT EXISTS idx_ses_suppression_practice
  ON ses_suppression_list(practice_id, added_at DESC);

ALTER TABLE ses_suppression_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ses_suppression_read_own_practice_or_global"
  ON ses_suppression_list FOR SELECT
  USING (
    practice_id IS NULL
    OR practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID
  );

CREATE POLICY "ses_suppression_insert_own_practice"
  ON ses_suppression_list FOR INSERT
  WITH CHECK (
    practice_id IS NULL
    OR practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID
  );

CREATE POLICY "ses_suppression_delete_own_practice"
  ON ses_suppression_list FOR DELETE
  USING (
    practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID
  );

CREATE POLICY "ses_suppression_service_role_all"
  ON ses_suppression_list FOR ALL
  USING (true) WITH CHECK (true);

COMMENT ON TABLE ses_suppression_list IS
  'Email addresses that must NOT receive transactional mail. Populated by '
  'the SNS bounce/complaint webhook (hard_bounce, complaint) and by manual '
  'admin action (manual). Global rows (practice_id NULL) suppress across '
  'every practice.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Email send log
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_send_log (
  id              BIGSERIAL PRIMARY KEY,
  practice_id     UUID REFERENCES practices(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  template_id     TEXT NOT NULL,
  category        TEXT,
  ses_message_id  TEXT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          TEXT NOT NULL CHECK (status IN ('sent', 'suppressed', 'failed', 'bounced', 'complaint', 'delivered')),
  error_message   TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_email_log_practice_recent
  ON email_send_log(practice_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_log_recipient_recent
  ON email_send_log(LOWER(recipient_email), sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_log_message_id
  ON email_send_log(ses_message_id) WHERE ses_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_log_template
  ON email_send_log(template_id, sent_at DESC);

ALTER TABLE email_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_log_read_own_practice"
  ON email_send_log FOR SELECT
  USING (practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID);

CREATE POLICY "email_log_insert_own_practice"
  ON email_send_log FOR INSERT
  WITH CHECK (practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID);

CREATE POLICY "email_log_service_role_all"
  ON email_send_log FOR ALL
  USING (true) WITH CHECK (true);

COMMENT ON TABLE email_send_log IS
  'One row per attempted transactional email send (including suppressed / '
  'failed attempts). Status transitions: sent -> delivered -> bounced or '
  'complaint, applied by the SNS webhook keyed on ses_message_id.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Notification preference columns
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS appointment_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS appointment_confirmations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS intake_invitations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS custom_form_invitations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS payment_receipts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS credentialing_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS soft_bounce_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS soft_bounce_window_started_at TIMESTAMPTZ;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS appointment_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS intake_invitations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS custom_form_invitations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS payment_receipts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS soft_bounce_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS soft_bounce_window_started_at TIMESTAMPTZ;

COMMENT ON COLUMN users.appointment_reminders_enabled IS
  'Toggle for appointment-reminder-{24h,2h} emails. Defaults TRUE. '
  'account_creation and password_reset are NEVER togglable.';

COMMENT ON COLUMN patients.soft_bounce_count IS
  'Count of soft bounces in the current 30-day rolling window. Cleared '
  'and re-anchored when soft_bounce_window_started_at is older than 30d. '
  'Practice owner is alerted at >=3.';

-- Down migration (manual):
--   DROP TABLE IF EXISTS email_send_log;
--   DROP TABLE IF EXISTS ses_suppression_list;
--   ALTER TABLE users  DROP COLUMN IF EXISTS appointment_reminders_enabled, ...
--   ALTER TABLE patients DROP COLUMN IF EXISTS appointment_reminders_enabled, ...

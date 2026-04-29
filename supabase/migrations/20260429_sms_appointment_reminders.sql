-- 20260429_sms_appointment_reminders.sql
--
-- Wave 50 — SignalWire SMS appointment reminder pipeline.
-- Adds:
--   1. sms_suppression_list   — durable opt-out + carrier-bounce list
--                               (richer than the legacy sms_opt_outs which
--                               only tracks STOP keyword replies; this one
--                               also captures hard bounces / invalid numbers
--                               returned by SignalWire status callbacks).
--   2. sms_send_log            — every send + every inbound message; the
--                               cron uses this to dedupe so the same
--                               appointment never gets the same threshold
--                               reminder twice.
--   3. user_notification_preferences columns —
--        sms_appointment_reminders_enabled  (default TRUE)
--        sms_cancellation_fill_enabled      (default TRUE)
--        sms_two_factor_enabled              (default TRUE)
--
-- All new tables are scoped per practice_id and protected by RLS that
-- mirrors sms_opt_outs (read+write gated on practice_id matching the
-- caller's users.practice_id). Migration is fully reversible — see the
-- DOWN block at the bottom.

-- ===========================================================================
-- UP
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sms_suppression_list
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_suppression_list (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id   uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  phone         text NOT NULL,                       -- E.164
  reason        text NOT NULL,                       -- 'stop_keyword' | 'hard_bounce' | 'invalid_number' | 'manual'
  source        text NOT NULL DEFAULT 'system',      -- 'inbound_sms' | 'status_callback' | 'dashboard' | 'system'
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  cleared_at    timestamptz,                          -- set when patient texts START
  UNIQUE (practice_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_sms_suppression_practice_phone
  ON sms_suppression_list (practice_id, phone)
  WHERE cleared_at IS NULL;

ALTER TABLE sms_suppression_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sms_suppression_practice_select" ON sms_suppression_list;
CREATE POLICY "sms_suppression_practice_select"
  ON sms_suppression_list FOR SELECT
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "sms_suppression_practice_all" ON sms_suppression_list;
CREATE POLICY "sms_suppression_practice_all"
  ON sms_suppression_list FOR ALL
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()))
  WITH CHECK (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

COMMENT ON TABLE sms_suppression_list IS
  'Wave 50 — durable per-practice SMS suppression. Populated by the inbound webhook (STOP keywords) and SignalWire status callbacks (hard bounces). Checked by lib/aws/signalwire-sms.sendSms before every outbound send.';


-- ---------------------------------------------------------------------------
-- 2. sms_send_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_send_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id         uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  appointment_id      uuid,
  patient_id          uuid,
  to_phone            text,
  from_phone          text,
  direction           text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  template_category   text,
  reminder_threshold  text,
  body                text,
  status              text NOT NULL,
  signalwire_sid      text,
  audit_event_type    text,
  details             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_send_log_appointment_threshold
  ON sms_send_log (appointment_id, reminder_threshold)
  WHERE appointment_id IS NOT NULL AND reminder_threshold IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sms_send_log_practice_created
  ON sms_send_log (practice_id, created_at DESC);

ALTER TABLE sms_send_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sms_send_log_practice_select" ON sms_send_log;
CREATE POLICY "sms_send_log_practice_select"
  ON sms_send_log FOR SELECT
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "sms_send_log_practice_all" ON sms_send_log;
CREATE POLICY "sms_send_log_practice_all"
  ON sms_send_log FOR ALL
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()))
  WITH CHECK (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

COMMENT ON TABLE sms_send_log IS
  'Wave 50 — append-only log of every SMS send attempt and every inbound message. Cron uses (appointment_id, reminder_threshold) for idempotency; ops uses (practice_id, created_at) to scan recent activity.';


-- ---------------------------------------------------------------------------
-- 3. user_notification_preferences — extend with SMS toggles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  practice_id uuid REFERENCES practices(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_notification_preferences
  ADD COLUMN IF NOT EXISTS sms_appointment_reminders_enabled boolean NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sms_cancellation_fill_enabled    boolean NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sms_two_factor_enabled            boolean NOT NULL DEFAULT TRUE;

ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_notif_prefs_self_read" ON user_notification_preferences;
CREATE POLICY "user_notif_prefs_self_read"
  ON user_notification_preferences FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_notif_prefs_self_write" ON user_notification_preferences;
CREATE POLICY "user_notif_prefs_self_write"
  ON user_notification_preferences FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON COLUMN user_notification_preferences.sms_appointment_reminders_enabled IS
  'Wave 50 — gate for the 24h / 2h / 30min cron-driven reminder dispatcher.';
COMMENT ON COLUMN user_notification_preferences.sms_cancellation_fill_enabled IS
  'Wave 50 — gate for cancellation-fill SMS offers.';
COMMENT ON COLUMN user_notification_preferences.sms_two_factor_enabled IS
  'Wave 50 — gate for 2FA login codes delivered over SMS.';


-- ===========================================================================
-- DOWN  (reversible — colocated for op convenience)
-- ===========================================================================
-- BEGIN;
--   ALTER TABLE user_notification_preferences
--     DROP COLUMN IF EXISTS sms_two_factor_enabled,
--     DROP COLUMN IF EXISTS sms_cancellation_fill_enabled,
--     DROP COLUMN IF EXISTS sms_appointment_reminders_enabled;
--   DROP INDEX IF EXISTS idx_sms_send_log_practice_created;
--   DROP INDEX IF EXISTS idx_sms_send_log_appointment_threshold;
--   DROP TABLE IF EXISTS sms_send_log;
--   DROP INDEX IF EXISTS idx_sms_suppression_practice_phone;
--   DROP TABLE IF EXISTS sms_suppression_list;
-- COMMIT;

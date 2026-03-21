-- Notification preferences system with Slack, Smart Light, and PWA push support
-- Add notification_prefs JSONB column to practices table
ALTER TABLE practices ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{
  "crisis": {"sms": true, "push": true, "slack": false, "smart_light": false},
  "arrival": {"sms": true, "push": true, "slack": false, "smart_light": false},
  "in_session_mode": false,
  "in_session_silent_only": true,
  "slack_webhook_url": null,
  "smart_light_webhook_url": null
}'::jsonb;

-- Push notification subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_practice ON push_subscriptions(practice_id);

-- Enable RLS on push_subscriptions
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS policies for push_subscriptions
CREATE POLICY "Users can read own practice push subscriptions"
  ON push_subscriptions FOR SELECT
  USING (practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID);

CREATE POLICY "Users can insert own practice push subscriptions"
  ON push_subscriptions FOR INSERT
  WITH CHECK (practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID);

CREATE POLICY "Users can delete own practice push subscriptions"
  ON push_subscriptions FOR DELETE
  USING (practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID);

CREATE POLICY "Service role can manage all push subscriptions"
  ON push_subscriptions FOR ALL
  USING (true)
  WITH CHECK (true);

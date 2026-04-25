-- Calendar connections table for Apple CalDAV, Google Calendar, and Outlook sync
-- Run this in your Supabase SQL editor: https://app.supabase.com/project/_/sql/new

CREATE TABLE IF NOT EXISTS calendar_connections (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  label TEXT,
  caldav_url TEXT DEFAULT 'https://caldav.icloud.com',
  caldav_username TEXT,
  caldav_password TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  sync_enabled BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(practice_id, provider)
);

ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own calendar connections"
  ON calendar_connections
  FOR ALL
  USING (
    practice_id IN (
      SELECT id FROM practices
      WHERE notification_email = auth.email()
    )
  );

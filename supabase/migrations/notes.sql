-- Session notes with voice dictation and EHR sync
CREATE TABLE IF NOT EXISTS session_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  patient_name TEXT,
  patient_phone TEXT,
  session_date DATE DEFAULT CURRENT_DATE,
  note_text TEXT NOT NULL,
  audio_url TEXT,
  transcription_model TEXT DEFAULT 'whisper',
  ehr_synced BOOLEAN DEFAULT FALSE,
  ehr_synced_at TIMESTAMPTZ,
  ehr_system TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_notes_practice ON session_notes(practice_id);
CREATE INDEX IF NOT EXISTS idx_session_notes_date ON session_notes(practice_id, session_date DESC);

-- Enable RLS on session_notes
ALTER TABLE session_notes ENABLE ROW LEVEL SECURITY;

-- RLS policies for session_notes
CREATE POLICY "Users can read own practice session notes"
  ON session_notes FOR SELECT
  USING (practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID);

CREATE POLICY "Users can insert own practice session notes"
  ON session_notes FOR INSERT
  WITH CHECK (practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID);

CREATE POLICY "Users can update own practice session notes"
  ON session_notes FOR UPDATE
  USING (practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID)
  WITH CHECK (practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID);

CREATE POLICY "Users can delete own practice session notes"
  ON session_notes FOR DELETE
  USING (practice_id = (auth.jwt() -> 'app_metadata' ->> 'practice_id')::UUID);

CREATE POLICY "Service role can manage all session notes"
  ON session_notes FOR ALL
  USING (true)
  WITH CHECK (true);

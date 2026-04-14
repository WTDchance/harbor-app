-- SMS opt-out / unsubscribe tracking (A2P / TCPA compliance)
-- Records every phone number that has replied STOP (or similar) so that
-- subsequent outbound SMS sends skip those numbers per-practice.

CREATE TABLE IF NOT EXISTS sms_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  phone text NOT NULL,
  keyword text,                          -- STOP / UNSUBSCRIBE / CANCEL / etc.
  source text DEFAULT 'sms_inbound',     -- sms_inbound | dashboard | api
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_sms_opt_outs_practice_phone
  ON sms_opt_outs (practice_id, phone);

-- RLS
ALTER TABLE sms_opt_outs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Practice members can view their opt-outs" ON sms_opt_outs;
CREATE POLICY "Practice members can view their opt-outs"
  ON sms_opt_outs FOR SELECT
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Practice members can manage their opt-outs" ON sms_opt_outs;
CREATE POLICY "Practice members can manage their opt-outs"
  ON sms_opt_outs FOR ALL
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()))
  WITH CHECK (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

COMMENT ON TABLE sms_opt_outs IS
  'Per-practice STOP list. Populated by /api/sms/inbound when patient texts a stop keyword. Checked by lib/twilio.sendSMS before every outbound send.';

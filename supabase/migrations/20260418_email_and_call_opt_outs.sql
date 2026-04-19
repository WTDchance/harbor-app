-- Communication opt-outs (2026-04-18)
-- Mirrors sms_opt_outs so every outbound channel has the same shape and
-- the dashboard can expose a single consistent Communication preferences UI.
-- Populated automatically (e.g. bounces/complaints, or future inbound STOP
-- handling) and manually from the patient detail page.

-- ============================================================
-- email_opt_outs: patient has asked not to receive email from this practice
-- ============================================================
CREATE TABLE IF NOT EXISTS email_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  email text NOT NULL,
  source text DEFAULT 'dashboard',       -- dashboard | inbound | api | bounce
  keyword text,                          -- populated if derived from an inbound reply
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, email)
);

CREATE INDEX IF NOT EXISTS idx_email_opt_outs_practice_email
  ON email_opt_outs (practice_id, email);

ALTER TABLE email_opt_outs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Practice members can view their email opt-outs" ON email_opt_outs;
CREATE POLICY "Practice members can view their email opt-outs"
  ON email_opt_outs FOR SELECT
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Practice members can manage their email opt-outs" ON email_opt_outs;
CREATE POLICY "Practice members can manage their email opt-outs"
  ON email_opt_outs FOR ALL
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()))
  WITH CHECK (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

COMMENT ON TABLE email_opt_outs IS
  'Per-practice email opt-out list. Gated by lib/email.sendPatientEmail before every patient-facing send.';

-- ============================================================
-- call_opt_outs: patient has asked not to be called
-- Passive today (Harbor only answers inbound calls). Reserved for any
-- future outbound call feature so the DNC list is already populated.
-- ============================================================
CREATE TABLE IF NOT EXISTS call_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  phone text NOT NULL,
  source text DEFAULT 'dashboard',       -- dashboard | api
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_call_opt_outs_practice_phone
  ON call_opt_outs (practice_id, phone);

ALTER TABLE call_opt_outs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Practice members can view their call opt-outs" ON call_opt_outs;
CREATE POLICY "Practice members can view their call opt-outs"
  ON call_opt_outs FOR SELECT
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Practice members can manage their call opt-outs" ON call_opt_outs;
CREATE POLICY "Practice members can manage their call opt-outs"
  ON call_opt_outs FOR ALL
  USING (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()))
  WITH CHECK (practice_id = (SELECT practice_id FROM users WHERE id = auth.uid()));

COMMENT ON TABLE call_opt_outs IS
  'Per-practice DNC list. Passive today — no outbound call path exists. Reserved so the opt-out state is captured now and honored whenever outbound calling ships.';

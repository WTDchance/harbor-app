-- Cancellation Fill System — Phase 1 foundation (applied 2026-04-20)
-- See docs/cancellation-fill-design.md for the full multi-phase design.
--
-- This migration is ADDITIVE ONLY. Existing cancellation behavior is unchanged.
-- Subsequent phases (dispatcher, bucket handlers, shift-earlier flow) build on
-- the scaffolding added here.

-- Per-practice fill policy. Defaults are the "safe, auto-fill-where-reasonable"
-- configuration described in docs/cancellation-policy.md. Therapists can
-- override any key via Settings -> Scheduling (Phase 7 UI).
ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS cancellation_policy JSONB NOT NULL DEFAULT '{
    "auto_fill_24plus_hr": true,
    "auto_fill_8_to_24_hr": true,
    "auto_fill_2_to_8_hr": true,
    "sub_1_hour_action": "shift_earlier",
    "late_cancel_fee_cents": 0,
    "waitlist_sort": "fifo",
    "flash_fill_max_recipients": 2,
    "insurance_eligibility_gate": true,
    "crisis_lookback_days": 14,
    "no_show_lookback_days": 30,
    "no_show_threshold": 2,
    "outstanding_balance_threshold_cents": 0
  }'::jsonb;

COMMENT ON COLUMN practices.cancellation_policy IS
  'JSONB with 4-bucket cancellation-fill settings. See docs/cancellation-fill-design.md.';

-- Waitlist opt-in flags. Off-by-default so patients only get last-minute
-- / flash offers if they explicitly asked for them.
ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS flexible_day_time BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_in_last_minute BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_in_flash_fill BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS composite_score NUMERIC;

-- Audit table: one row per fill offer, so we can cascade on expiry, answer
-- "why did this patient get this slot?", and power the Fill History widget.
CREATE TABLE IF NOT EXISTS cancellation_fill_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  original_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  offered_to_patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  offered_to_waitlist_id UUID REFERENCES waitlist(id) ON DELETE SET NULL,
  slot_time TIMESTAMPTZ NOT NULL,
  bucket TEXT NOT NULL CHECK (bucket IN ('24plus','8_to_24','2_to_8','sub_1','shift_earlier')),
  channel TEXT NOT NULL CHECK (channel IN ('sms','email','both')),
  offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  offer_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','declined','expired','superseded')),
  claimed_at TIMESTAMPTZ,
  created_appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_fill_offers_practice_status ON cancellation_fill_offers(practice_id, status);
CREATE INDEX IF NOT EXISTS idx_fill_offers_pending_slot ON cancellation_fill_offers(slot_time) WHERE status = 'pending';

COMMENT ON TABLE cancellation_fill_offers IS
  'Every fill attempt logged here - one row per candidate who received an offer. See docs/cancellation-fill-design.md.';

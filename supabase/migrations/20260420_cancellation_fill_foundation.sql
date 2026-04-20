-- Cancellation Fill — Phase 1 foundation
-- Adds practice-level dispatcher settings (new column name to avoid collision
-- with existing `cancellation_policy TEXT` column which stores freeform policy
-- text consumed by the voice-server system prompt).
--
-- Adds waitlist opt-in flags used by Phase 3 bucket handlers.
-- Creates cancellation_fill_offers audit table used by every phase.
--
-- SAFE to re-run. All statements use IF NOT EXISTS or idempotent guards.

------------------------------------------------------------
-- 1. Practice-level dispatcher settings (JSONB)
------------------------------------------------------------

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS cancellation_fill_settings JSONB NOT NULL DEFAULT '{
    "dispatcher_enabled": false,
    "auto_fill_24plus": true,
    "auto_fill_8_to_24": true,
    "auto_fill_2_to_8": true,
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

COMMENT ON COLUMN practices.cancellation_fill_settings IS
  'Structured settings for the cancellation-fill dispatcher. Do NOT confuse with `cancellation_policy` (TEXT) which is freeform policy text read aloud by Ellie. dispatcher_enabled defaults to false — fail-closed.';

------------------------------------------------------------
-- 2. Waitlist opt-in flags (already applied earlier — idempotent)
------------------------------------------------------------

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS flexible_day_time BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_in_last_minute BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_in_flash_fill BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS composite_score NUMERIC;

------------------------------------------------------------
-- 3. Offer audit table
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cancellation_fill_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES practices(id),
  original_appointment_id UUID REFERENCES appointments(id),
  offered_to_patient_id UUID REFERENCES patients(id),
  offered_to_waitlist_id UUID REFERENCES waitlist(id),
  slot_time TIMESTAMPTZ NOT NULL,
  bucket TEXT NOT NULL CHECK (bucket IN ('24plus','8_to_24','2_to_8','sub_1','shift_earlier')),
  channel TEXT NOT NULL CHECK (channel IN ('sms','email','both','none')),
  offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  offer_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','declined','expired','superseded','observed')),
  claimed_at TIMESTAMPTZ,
  created_appointment_id UUID REFERENCES appointments(id),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_fill_offers_practice_status ON cancellation_fill_offers(practice_id, status);
CREATE INDEX IF NOT EXISTS idx_fill_offers_slot ON cancellation_fill_offers(slot_time) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_fill_offers_original_appt ON cancellation_fill_offers(original_appointment_id);

COMMENT ON TABLE cancellation_fill_offers IS
  'Audit trail for every fill-offer decision. status=observed means Phase 2 dispatcher only logged the decision without sending a real offer (dry-run mode).';

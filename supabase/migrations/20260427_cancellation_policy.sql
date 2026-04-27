-- Wave 42 — Practice-level cancellation policy + late-fee enforcement.
--
-- Background: therapists eat the cost of last-minute cancellations and
-- no-shows today. This migration introduces a per-practice policy that
-- (a) charges the patient's saved card when they cancel inside a
-- practice-defined notice window, and (b) charges a (possibly different)
-- fee when an appointment is marked as no_show. Policy is opt-in: if
-- cancellation_policy_hours IS NULL, no fee is ever assessed.
--
-- Stripe rationale:
--   * Late-cancel and no-show charges are separate Stripe Charges with
--     separate ids so refunds (waivers) are atomic.
--   * Charges only fire when the patient has a stripe_customer_id with
--     a default payment method on file. If no card, we mark the fee as
--     billable (cancellation_fee_charged_cents IS NULL with
--     late_canceled_at set) so it surfaces on the patient invoice flow.
--   * If the Stripe charge declines, the cancellation is NOT blocked —
--     the appointment is still cancelled / marked no-show. Failure
--     telemetry lives in audit_logs.

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS cancellation_policy_hours  INTEGER NULL,
  ADD COLUMN IF NOT EXISTS cancellation_fee_cents     INTEGER NULL,
  ADD COLUMN IF NOT EXISTS no_show_fee_cents          INTEGER NULL,
  ADD COLUMN IF NOT EXISTS cancellation_policy_text   TEXT NULL;

COMMENT ON COLUMN public.practices.cancellation_policy_hours IS
  'Notice window in hours. A patient cancellation arriving with strictly fewer than this many hours of notice triggers the late-cancel fee. NULL disables the policy entirely (no fee ever charged).';
COMMENT ON COLUMN public.practices.cancellation_fee_cents IS
  'Late-cancel fee charged to the patient''s saved card (USD cents). NULL = no late-cancel fee even if hours threshold is set.';
COMMENT ON COLUMN public.practices.no_show_fee_cents IS
  'Fee charged when an appointment is marked status=''no_show'' (USD cents). Independent of late-cancel; NULL = no no-show fee.';
COMMENT ON COLUMN public.practices.cancellation_policy_text IS
  'Human-readable policy summary shown to patients during scheduling and cancellation. REQUIRED to be displayed for any fee enforcement to be enforceable.';

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS late_canceled_at                  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cancellation_fee_charged_cents    INTEGER NULL,
  ADD COLUMN IF NOT EXISTS no_show_fee_charged_cents         INTEGER NULL,
  ADD COLUMN IF NOT EXISTS cancellation_fee_stripe_charge_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS no_show_fee_stripe_charge_id      TEXT NULL;

COMMENT ON COLUMN public.appointments.late_canceled_at IS
  'Timestamp set when a patient cancellation arrived inside the practice''s policy window. NULL for cancellations outside the window or for therapist-initiated cancellations.';
COMMENT ON COLUMN public.appointments.cancellation_fee_charged_cents IS
  'Amount actually charged for the late cancel (USD cents). 0 after a waiver/refund; NULL when no charge has been attempted yet (e.g. patient has no card on file and the fee is billable on invoice instead).';
COMMENT ON COLUMN public.appointments.no_show_fee_charged_cents IS
  'Amount actually charged for the no-show (USD cents). 0 after a waiver/refund; NULL when no charge has been attempted yet.';
COMMENT ON COLUMN public.appointments.cancellation_fee_stripe_charge_id IS
  'Stripe Charge id (ch_…) for the late-cancel fee. Separate from no_show_fee_stripe_charge_id so refunds are atomic.';
COMMENT ON COLUMN public.appointments.no_show_fee_stripe_charge_id IS
  'Stripe Charge id (ch_…) for the no-show fee. Separate from cancellation_fee_stripe_charge_id so refunds are atomic.';

CREATE INDEX IF NOT EXISTS idx_appointments_late_canceled
  ON public.appointments (practice_id, late_canceled_at)
  WHERE late_canceled_at IS NOT NULL;

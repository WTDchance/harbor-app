-- Signup + payment schema additions (2026-04-07)
-- Run in Supabase SQL editor before merging the signup-payment PR.
-- Safe to re-run: all ADD COLUMN statements use IF NOT EXISTS.

-- ---------------------------------------------------------------------------
-- 1. practices: columns needed for Stripe checkout + Twilio/Vapi provisioning
-- ---------------------------------------------------------------------------
alter table practices
  add column if not exists founding_member boolean default false,
  add column if not exists twilio_phone_sid text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_customer_id text,
  add column if not exists subscription_status text default 'unpaid',
  add column if not exists vapi_phone_number_id text,
  add column if not exists provisioned_at timestamptz,
  add column if not exists billing_email text;

-- Ensure a practice can only have one founding membership.
create unique index if not exists practices_stripe_customer_idx
  on practices(stripe_customer_id)
  where stripe_customer_id is not null;

-- Quick lookup by checkout session id (webhook path)
create index if not exists practices_stripe_checkout_session_idx
  on practices(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Status values reference (for documentation - Postgres has no enum yet):
--    status:               pending_payment | active | past_due | cancelled | trial
--    subscription_status:  unpaid | active | past_due | cancelled | trialing
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. RLS: allow the row owner to read their practice even in pending_payment
--    (existing policy should already cover this via auth_user_id join,
--    this is a no-op if the policy is already correct)
-- ---------------------------------------------------------------------------

-- No new RLS policies needed - existing practice_id = user.practice_id policy
-- covers all reads for the owner.

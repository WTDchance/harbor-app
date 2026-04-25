-- Harbor Stripe Billing Migration
-- Run in Supabase SQL Editor at: https://supabase.com/dashboard/project/[PROJECT_ID]/sql

-- Add billing columns to practices table
ALTER TABLE practices ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trialing';
ALTER TABLE practices ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days');
ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_email TEXT;

-- Create indexes for billing lookups
CREATE INDEX IF NOT EXISTS idx_practices_stripe_customer ON practices(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_practices_stripe_subscription ON practices(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_practices_subscription_status ON practices(subscription_status);
CREATE INDEX IF NOT EXISTS idx_practices_trial_ends ON practices(trial_ends_at) WHERE subscription_status = 'trialing';

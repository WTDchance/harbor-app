-- Wave 50 — Harbor-as-vendor Stripe subscription billing.
--
-- Charges therapy practices for using Harbor (NOT patient-payment work —
-- that's a separate pipeline). Backs four pricing tiers defined in
-- lib/billing/stripe-products.ts:
--   reception_only_monthly   $99
--   solo_cash_pay_monthly    $149
--   solo_in_network_monthly  $299
--   group_practice_monthly   $899
--
-- Adds three tables (subscriptions, events for webhook idempotency,
-- invoices) plus a `status` column on practices used to gate access on
-- past-due/suspended state.
--
-- Reversible — paired down file at:
--   20260429_stripe_subscription_billing.down.sql

-- ---------------------------------------------------------------------------
-- 1. practices.status — gate access for unpaid / suspended practices
-- ---------------------------------------------------------------------------
-- Using a CHECK constraint rather than an enum so we can extend in-place.
-- 'active' is the default for every existing row.
ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'past_due', 'suspended', 'canceled'));

CREATE INDEX IF NOT EXISTS idx_practices_status
  ON public.practices (status)
  WHERE status <> 'active';

COMMENT ON COLUMN public.practices.status IS
  'W50 — billing-driven access gate. ''suspended'' is set by the dunning '
  'sequence after 14 days unpaid; middleware redirects suspended practices '
  'to /dashboard/settings/billing.';

-- Stripe customer id was already added in 20260407_signup_payment.sql
-- (column already exists). Keep the IF NOT EXISTS for idempotency on
-- legacy clusters.
ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- ---------------------------------------------------------------------------
-- 2. practice_subscriptions
--    One row per practice (UNIQUE on practice_id). Mirrors the live Stripe
--    subscription state so the dashboard / middleware doesn't have to round
--    trip to Stripe on every page load.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.practice_subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id              UUID NOT NULL UNIQUE
                             REFERENCES public.practices(id) ON DELETE CASCADE,

  stripe_customer_id       TEXT NOT NULL,
  stripe_subscription_id   TEXT,
  stripe_price_id          TEXT,

  -- Canonical Harbor tier label. Free-form here so non-listed tiers (legacy
  -- founding-member, comp, etc.) don't break the constraint, but the four
  -- supported tiers are enforced.
  tier                     TEXT NOT NULL
                             CHECK (tier IN (
                               'reception_only_monthly',
                               'solo_cash_pay_monthly',
                               'solo_in_network_monthly',
                               'group_practice_monthly'
                             )),

  -- Mirrors Stripe's subscription.status enum. Keeping 'paused' for
  -- account-level holds even though Stripe's "pause_collection" is
  -- modeled separately — easier than juggling two flags.
  status                   TEXT NOT NULL
                             CHECK (status IN (
                               'trialing','active','past_due','canceled',
                               'incomplete','unpaid','paused'
                             )),

  trial_ends_at            TIMESTAMPTZ,
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at              TIMESTAMPTZ,

  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_practice_subscriptions_status
  ON public.practice_subscriptions (status)
  WHERE status IN ('past_due', 'unpaid', 'incomplete');

CREATE INDEX IF NOT EXISTS idx_practice_subscriptions_stripe_sub
  ON public.practice_subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_practice_subscriptions_trial_end
  ON public.practice_subscriptions (trial_ends_at)
  WHERE status = 'trialing';

CREATE OR REPLACE FUNCTION public.practice_subscriptions_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_practice_subscriptions_updated_at
  ON public.practice_subscriptions;
CREATE TRIGGER trg_practice_subscriptions_updated_at
  BEFORE UPDATE ON public.practice_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.practice_subscriptions_touch();

ALTER TABLE public.practice_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_subscriptions_per_practice
  ON public.practice_subscriptions;
CREATE POLICY practice_subscriptions_per_practice
  ON public.practice_subscriptions
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.practice_subscriptions IS
  'W50 — local mirror of the Stripe subscription that bills the practice '
  'for using Harbor. Updated by /api/webhooks/stripe-subscription on '
  'customer.subscription.* events. UNIQUE(practice_id) enforces one '
  'subscription per practice.';

-- ---------------------------------------------------------------------------
-- 3. practice_subscription_events
--    Webhook idempotency table. The webhook inserts here FIRST, before any
--    state mutation, and treats a unique-violation on stripe_event_id as
--    "already processed → return 200." This is the lock that prevents
--    duplicate event delivery from double-applying state transitions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.practice_subscription_events (
  id                BIGSERIAL PRIMARY KEY,
  practice_id       UUID REFERENCES public.practices(id) ON DELETE CASCADE,

  stripe_event_id   TEXT NOT NULL UNIQUE,
  event_type        TEXT NOT NULL,
  raw_payload       JSONB NOT NULL,

  processed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_practice_subscription_events_practice
  ON public.practice_subscription_events (practice_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_practice_subscription_events_type
  ON public.practice_subscription_events (event_type, processed_at DESC);

ALTER TABLE public.practice_subscription_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_subscription_events_per_practice
  ON public.practice_subscription_events;
CREATE POLICY practice_subscription_events_per_practice
  ON public.practice_subscription_events
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.practice_subscription_events IS
  'W50 — webhook idempotency log. Insert-first-with-unique-violation '
  'pattern de-dupes Stripe event delivery. Also serves as a forensic '
  'event store — every customer.subscription.* / invoice.* event is '
  'archived here with the raw_payload preserved.';

-- ---------------------------------------------------------------------------
-- 4. practice_invoices
--    Local cache of every Stripe invoice for the practice. Driven by the
--    invoice.* webhook events. Enables the /dashboard/settings/billing
--    invoice history page without round-tripping to Stripe.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.practice_invoices (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id              UUID NOT NULL
                             REFERENCES public.practices(id) ON DELETE CASCADE,

  stripe_invoice_id        TEXT NOT NULL UNIQUE,
  stripe_invoice_number    TEXT,

  amount_due_cents         INTEGER NOT NULL DEFAULT 0,
  amount_paid_cents        INTEGER NOT NULL DEFAULT 0,
  currency                 TEXT NOT NULL DEFAULT 'usd',

  status                   TEXT NOT NULL,

  invoice_pdf_url          TEXT,
  hosted_invoice_url       TEXT,

  paid_at                  TIMESTAMPTZ,
  due_date                 TIMESTAMPTZ,

  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_practice_invoices_practice
  ON public.practice_invoices (practice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_practice_invoices_status
  ON public.practice_invoices (status);

ALTER TABLE public.practice_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_invoices_per_practice ON public.practice_invoices;
CREATE POLICY practice_invoices_per_practice
  ON public.practice_invoices
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.practice_invoices IS
  'W50 — local cache of Stripe invoices for the practice. Populated by '
  '/api/webhooks/stripe-subscription on invoice.* events. Powers the '
  'invoice-history table on /dashboard/settings/billing.';

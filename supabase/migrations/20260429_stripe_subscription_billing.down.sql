-- Down migration paired with 20260429_stripe_subscription_billing.sql.
-- Drops in reverse FK-dependency order. Safe to re-run.

DROP POLICY IF EXISTS practice_invoices_per_practice ON public.practice_invoices;
DROP TABLE IF EXISTS public.practice_invoices;

DROP POLICY IF EXISTS practice_subscription_events_per_practice
  ON public.practice_subscription_events;
DROP TABLE IF EXISTS public.practice_subscription_events;

DROP TRIGGER IF EXISTS trg_practice_subscriptions_updated_at
  ON public.practice_subscriptions;
DROP FUNCTION IF EXISTS public.practice_subscriptions_touch();
DROP POLICY IF EXISTS practice_subscriptions_per_practice
  ON public.practice_subscriptions;
DROP TABLE IF EXISTS public.practice_subscriptions;

DROP INDEX IF EXISTS public.idx_practices_status;
ALTER TABLE public.practices DROP COLUMN IF EXISTS status;

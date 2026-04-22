-- Stripe patient-customer linking for the billing flow.

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_patients_stripe_customer
  ON public.patients (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Note: Harbor's existing Stripe webhook at /api/stripe/webhook already
-- dispatches subscription events. Patient invoices use a separate event
-- type (invoice.paid) so they don't conflict.

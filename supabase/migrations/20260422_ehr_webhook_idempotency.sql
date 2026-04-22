-- Webhook idempotency — Stripe retries (and network dupes) can send the
-- same event more than once. Record what we've handled so a replay is
-- a no-op rather than duplicate payments / duplicate audits.

CREATE TABLE IF NOT EXISTS public.ehr_processed_webhook_events (
  event_id      TEXT PRIMARY KEY,  -- Stripe event ID (evt_xxx)
  event_type    TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'stripe',
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_hash  TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at
  ON public.ehr_processed_webhook_events (processed_at DESC);

-- TTL cleanup: events older than 90 days are safe to purge (Stripe's
-- retry window is far shorter). Done by a cron in practice — documented
-- in docs/harbor-ehr-billing.md.

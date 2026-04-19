-- ROI lead pipeline columns (2026-04-19)
-- Adds pipeline stage + next-action timestamp to roi_calculator_submissions so the
-- /admin/leads page can manage them like a real lead funnel.

ALTER TABLE roi_calculator_submissions
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new', 'contacted', 'demo_booked', 'proposal_sent', 'won', 'lost', 'unresponsive')),
  ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMPTZ;

COMMENT ON COLUMN roi_calculator_submissions.stage IS
  'Pipeline stage. new = just submitted, contacted = we made first outreach, demo_booked = call scheduled, proposal_sent = pricing discussed, won/lost/unresponsive = terminal states.';
COMMENT ON COLUMN roi_calculator_submissions.next_action_at IS
  'When we should next reach out. The admin dashboard surfaces leads whose next_action_at <= now() at the top of the daily list.';

-- Daily "who do I call today?" sort: surface leads with an overdue next_action,
-- then leads with upcoming next_action, then brand-new leads without one set.
CREATE INDEX IF NOT EXISTS idx_roi_submissions_next_action
  ON roi_calculator_submissions(stage, next_action_at NULLS LAST, created_at DESC);

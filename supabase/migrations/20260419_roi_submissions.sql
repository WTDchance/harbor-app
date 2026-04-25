-- ROI calculator lead capture (2026-04-19)
--
-- Every time a therapist (or prospect) fills in the public ROI calculator,
-- we store their inputs, the calculated outputs, and attribution data.
-- This is a sales-intelligence table: every row is a warm lead who was
-- engaged enough to fill in numbers about their practice.
--
-- Email is optional on the form, but strongly encouraged via the "email me
-- the report" CTA. Rows without email are still useful as aggregate signal
-- (what do prospects think their missed calls are worth on average?).

CREATE TABLE IF NOT EXISTS roi_calculator_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contact info (all optional to maximize completion rate)
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  practice_name TEXT,
  phone TEXT,

  -- Inputs (all cents or whole numbers — keep storage unambiguous)
  session_rate_cents INTEGER NOT NULL,
  missed_calls_per_week INTEGER NOT NULL,
  missed_appointments_per_week INTEGER NOT NULL DEFAULT 0,
  insurance_hours_per_week NUMERIC(5,2) NOT NULL DEFAULT 0,
  weeks_worked_per_year INTEGER NOT NULL DEFAULT 48,
  conversion_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 30.00,

  -- Calculated outputs (cents; computed server-side at submit to be
  -- source-of-truth-independent of client JS changes later)
  annual_revenue_loss_cents BIGINT NOT NULL,
  annual_time_loss_cents BIGINT NOT NULL DEFAULT 0,
  annual_total_loss_cents BIGINT NOT NULL,

  -- Attribution: where did this lead come from?
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  referrer_url TEXT,
  user_agent TEXT,
  ip_address INET,

  -- Follow-up state (sales can update these from the admin UI)
  contacted_at TIMESTAMPTZ,
  contacted_by TEXT,
  notes TEXT,
  converted_practice_id UUID REFERENCES practices(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE roi_calculator_submissions IS
  'Every public ROI-calculator submission. Warm-lead signal with inputs + calculated annual loss.';
COMMENT ON COLUMN roi_calculator_submissions.converted_practice_id IS
  'Set when this lead becomes a paying practice. Lets us measure ROI-calc → conversion rate.';

-- Sort by recency (sales dashboard's primary view).
CREATE INDEX IF NOT EXISTS idx_roi_submissions_recency
  ON roi_calculator_submissions(created_at DESC);

-- Email lookup to dedupe / find prior submissions from the same prospect.
CREATE INDEX IF NOT EXISTS idx_roi_submissions_email
  ON roi_calculator_submissions(lower(email))
  WHERE email IS NOT NULL;

-- Attribution rollup queries.
CREATE INDEX IF NOT EXISTS idx_roi_submissions_utm
  ON roi_calculator_submissions(utm_source, utm_campaign, created_at DESC)
  WHERE utm_source IS NOT NULL;

-- Service-role only — writes come from the public API route using supabaseAdmin,
-- reads from the admin dashboard. No end-user RLS needed since submissions are
-- created on behalf of unauthenticated visitors.
ALTER TABLE roi_calculator_submissions ENABLE ROW LEVEL SECURITY;

-- Track last weekly-eligibility-email send per practice so the cron route
-- can dedup against itself. Before this, /api/cron/weekly-eligibility-email
-- had NO dedup — so any duplicate cron-job.org schedule (or a manual retry)
-- would fan out multiple identical emails to the therapist. We observed a
-- practice receiving 4 copies at 15-min intervals.

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS weekly_eligibility_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN practices.weekly_eligibility_sent_at IS
  'Last successful send of the weekly "your week ahead" eligibility email. The cron route refuses to send again within 20 hours of this timestamp.';

-- Wave 43 / T4 — patient outreach & re-engagement.
--
-- Patients fall off the schedule for all kinds of reasons (life got
-- busy, insurance lapsed, didn't click with the therapist, scheduling
-- conflict). A practice that doesn't notice is leaving relationships
-- on the table — and clinically, lapsed patients sometimes need a
-- gentle nudge before symptoms recur.
--
-- This migration adds:
--   * ehr_reengagement_campaigns — per-practice templates for the
--     outreach: which channel, which message, what triggers it.
--   * ehr_reengagement_outreach — append-only log of attempts. One row
--     per (campaign, patient, sent_at) with the channel + status.
--
-- Triggers are computed on the read side (Today widget query) rather
-- than denormalized — avoids stale flags when an appointment is
-- canceled or a patient comes back on their own.

CREATE TABLE IF NOT EXISTS public.ehr_reengagement_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  -- Trigger threshold: flag patients with no completed appointment in
  -- the last N days (and no upcoming scheduled appointment). 60 / 90 /
  -- 180 are typical.
  inactive_days   INT  NOT NULL DEFAULT 90 CHECK (inactive_days BETWEEN 14 AND 730),
  -- Channel to outreach via. The actual send happens in the API layer
  -- (SES for email, SignalWire for SMS) — the campaign just declares
  -- the preferred channel; we honor patient.communication_preference
  -- on the actual send.
  channel         TEXT NOT NULL DEFAULT 'email'
                    CHECK (channel IN ('email', 'sms', 'patient_choice')),
  -- The message body. Template variables: {{first_name}},
  -- {{practice_name}}, {{schedule_link}}.
  subject         TEXT,
  body            TEXT NOT NULL,

  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reeng_campaigns_practice_active
  ON public.ehr_reengagement_campaigns (practice_id, active);

CREATE OR REPLACE FUNCTION public.ehr_reeng_campaigns_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_reeng_campaigns_updated_at ON public.ehr_reengagement_campaigns;
CREATE TRIGGER trg_ehr_reeng_campaigns_updated_at
  BEFORE UPDATE ON public.ehr_reengagement_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.ehr_reeng_campaigns_touch_updated_at();

ALTER TABLE public.ehr_reengagement_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reeng_campaigns_all ON public.ehr_reengagement_campaigns;
CREATE POLICY reeng_campaigns_all ON public.ehr_reengagement_campaigns
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ehr_reengagement_outreach (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  campaign_id     UUID REFERENCES public.ehr_reengagement_campaigns(id) ON DELETE SET NULL,

  channel         TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'sent', 'failed', 'replied', 'rebooked')),

  sent_at         TIMESTAMPTZ,
  failed_reason   TEXT,
  -- Filled in if/when the patient replies (SMS) or books an appointment
  -- after this outreach (computed by the dashboard cron / job).
  replied_at      TIMESTAMPTZ,
  rebooked_appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,

  initiated_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reeng_outreach_practice_patient
  ON public.ehr_reengagement_outreach (practice_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reeng_outreach_campaign
  ON public.ehr_reengagement_outreach (campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE public.ehr_reengagement_outreach ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reeng_outreach_select ON public.ehr_reengagement_outreach;
CREATE POLICY reeng_outreach_select ON public.ehr_reengagement_outreach
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS reeng_outreach_insert ON public.ehr_reengagement_outreach;
CREATE POLICY reeng_outreach_insert ON public.ehr_reengagement_outreach
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS reeng_outreach_update ON public.ehr_reengagement_outreach;
CREATE POLICY reeng_outreach_update ON public.ehr_reengagement_outreach
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

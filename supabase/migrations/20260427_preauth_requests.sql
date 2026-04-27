-- Wave 43 / W43-PRE — Insurance pre-authorization REQUEST workflow.
--
-- Wave 40 (ehr_insurance_authorizations) tracks auths that have already been
-- *granted* by the payer. This table tracks the *request* lifecycle: the
-- therapist drafts a packet, submits it to the payer (fax / portal / email /
-- mail / Stedi 278), and waits for a decision. When the payer responds with
-- 'approved' the record-response endpoint creates a downstream
-- ehr_insurance_authorizations row and links it back here via
-- resulting_authorization_id, so the audit chain "request -> grant" is intact.
--
-- Lifecycle:
--   draft       therapist building the packet, can still edit fields
--   submitted   packet went out to payer (fax/portal/email/mail/278)
--   pending     submission acknowledged, payer is reviewing
--   approved    payer issued an auth_number  -> spawns ehr_insurance_authorizations
--   denied      payer refused; record_response captures summary
--   expired     payer did not respond; therapist closed the loop
--   withdrawn   therapist pulled the request before payer ruled

CREATE TABLE IF NOT EXISTS public.ehr_preauth_requests (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id                    UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  practice_id                   UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  requested_by_user_id          UUID NOT NULL,

  payer_name                    TEXT NOT NULL,
  -- Free-text Stedi payer ID. Loosely linked to stedi_payers(stedi_id) via
  -- application code, but NOT a hard FK — payers in stedi_payers might be
  -- pruned/re-synced and we don't want a CASCADE knocking out historical
  -- pre-auth packets. Therapists may also enter a payer that is not in the
  -- Stedi directory.
  payer_payer_id                TEXT,
  member_id                     TEXT NOT NULL,

  cpt_codes                     TEXT[] NOT NULL,
  diagnosis_codes               TEXT[] NOT NULL,

  requested_session_count       INTEGER NOT NULL CHECK (requested_session_count > 0),
  requested_start_date          DATE    NOT NULL,
  requested_end_date            DATE,                  -- NULL = open-ended

  clinical_justification        TEXT NOT NULL,

  status                        TEXT NOT NULL DEFAULT 'draft'
                                  CHECK (status IN ('draft','submitted','pending','approved','denied','expired','withdrawn')),

  submitted_at                  TIMESTAMPTZ,
  submission_method             TEXT
                                  CHECK (submission_method IN ('fax','portal','email','mail','stedi_278')),
  submission_reference          TEXT,                  -- fax confirmation, portal case #, 278 trace ID, etc.

  payer_response_received_at    TIMESTAMPTZ,
  payer_response_summary        TEXT,

  -- Linked back when the payer says yes. References the W40 schema's PK.
  -- ON DELETE SET NULL: if the resulting auth row is purged we keep the
  -- request record (and the audit trail) intact.
  resulting_authorization_id    UUID
                                  REFERENCES public.ehr_insurance_authorizations(id)
                                  ON DELETE SET NULL,

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ehr_preauth_requests IS
  'Pre-authorization REQUESTS to payers (Wave 43). Lifecycle: draft -> '
  'submitted -> pending -> approved/denied/expired/withdrawn. On approval '
  'spawns an ehr_insurance_authorizations row (W40) and links via '
  'resulting_authorization_id.';

-- Indexes per spec.
CREATE INDEX IF NOT EXISTS idx_preauth_patient
  ON public.ehr_preauth_requests (patient_id);
CREATE INDEX IF NOT EXISTS idx_preauth_practice_status
  ON public.ehr_preauth_requests (practice_id, status);
-- The chase-reminder query: "submitted/pending requests waiting > 14 days".
CREATE INDEX IF NOT EXISTS idx_preauth_status_submitted
  ON public.ehr_preauth_requests (status, submitted_at);

-- updated_at trigger — mirrors the W40 auth_touch() pattern.
CREATE OR REPLACE FUNCTION public.preauth_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_preauth_touch ON public.ehr_preauth_requests;
CREATE TRIGGER trg_preauth_touch
  BEFORE UPDATE ON public.ehr_preauth_requests
  FOR EACH ROW EXECUTE FUNCTION public.preauth_touch();

-- RLS — practice_id-scoped, mirror the W40 ehr_insurance_authorizations pattern.
ALTER TABLE public.ehr_preauth_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS preauth_select ON public.ehr_preauth_requests;
CREATE POLICY preauth_select ON public.ehr_preauth_requests
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS preauth_insert ON public.ehr_preauth_requests;
CREATE POLICY preauth_insert ON public.ehr_preauth_requests
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS preauth_update ON public.ehr_preauth_requests;
CREATE POLICY preauth_update ON public.ehr_preauth_requests
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

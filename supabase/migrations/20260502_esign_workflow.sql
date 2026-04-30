-- Wave 52 / D1 — generic document e-signature.
-- ESIGN/UETA-aware: every signature row includes IP, user agent, signed_at,
-- signature_method. Final PDF stored in S3 with the audit trail embedded.

CREATE TABLE IF NOT EXISTS public.practice_document_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN (
                    'hipaa_npp',
                    'consent_for_treatment',
                    'release_of_information',
                    'telehealth_consent',
                    'financial_responsibility',
                    'treatment_plan',
                    'other'
                  )),

  -- Body in HTML with {{handlebars-style}} variables (replaced server-side
  -- at send time using the patient context).
  body_html       TEXT NOT NULL,
  variables       JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Field placements: [{ id, label, page, x, y, w, h, kind: 'signature'|'date'|'initials' }]
  signature_fields JSONB NOT NULL DEFAULT '[]'::jsonb,

  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_practice_document_templates_practice
  ON public.practice_document_templates (practice_id, status, category);

CREATE OR REPLACE FUNCTION public.practice_document_templates_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_practice_document_templates_updated_at ON public.practice_document_templates;
CREATE TRIGGER trg_practice_document_templates_updated_at
  BEFORE UPDATE ON public.practice_document_templates
  FOR EACH ROW EXECUTE FUNCTION public.practice_document_templates_touch();

ALTER TABLE public.practice_document_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_document_templates_all ON public.practice_document_templates;
CREATE POLICY practice_document_templates_all ON public.practice_document_templates
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));


CREATE TABLE IF NOT EXISTS public.document_signature_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id       UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id        UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  lead_id           UUID REFERENCES public.reception_leads(id) ON DELETE SET NULL,
  template_id       UUID REFERENCES public.practice_document_templates(id) ON DELETE SET NULL,

  -- Snapshot the rendered HTML at send time (so subsequent template edits
  -- don't retroactively change what the patient saw).
  rendered_body_html TEXT NOT NULL,

  recipient_email   TEXT,
  recipient_phone   TEXT,
  delivery_channel  TEXT NOT NULL CHECK (delivery_channel IN ('email','sms','both')),

  portal_token      TEXT NOT NULL UNIQUE,

  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','viewed','signed','expired','withdrawn')),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),

  viewed_at         TIMESTAMPTZ,
  signed_at         TIMESTAMPTZ,

  -- Final signed PDF — written by the sign endpoint, S3 key only (PHI lives
  -- in the S3 bucket; this row contains no transcript text).
  signed_pdf_s3_key TEXT,

  sent_by_user_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_signature_requests_practice
  ON public.document_signature_requests (practice_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_signature_requests_patient
  ON public.document_signature_requests (practice_id, patient_id, created_at DESC)
  WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_document_signature_requests_lead
  ON public.document_signature_requests (practice_id, lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.document_signature_requests_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_document_signature_requests_updated_at ON public.document_signature_requests;
CREATE TRIGGER trg_document_signature_requests_updated_at
  BEFORE UPDATE ON public.document_signature_requests
  FOR EACH ROW EXECUTE FUNCTION public.document_signature_requests_touch();

ALTER TABLE public.document_signature_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_signature_requests_all ON public.document_signature_requests;
CREATE POLICY document_signature_requests_all ON public.document_signature_requests
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));


-- ESIGN/UETA audit row. One per signature event. Captures everything a
-- court needs to validate consent.
CREATE TABLE IF NOT EXISTS public.document_signatures (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  signature_request_id     UUID NOT NULL REFERENCES public.document_signature_requests(id) ON DELETE CASCADE,

  signer_name              TEXT NOT NULL,
  signature_method         TEXT NOT NULL CHECK (signature_method IN ('typed','drawn','clicked')),
  -- Either typed name, base64 data: URL of canvas drawing, or 'I-AGREE' for clicked.
  signature_data           TEXT NOT NULL,

  -- Verification proof — DOB matched against the patient row at sign time.
  identity_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  identity_verification_method TEXT,

  ip_address               INET,
  user_agent               TEXT,
  signed_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- S3 key for the standalone audit-trail PDF (signature pad image, IP,
  -- user agent, timestamp, signer name). Embedded into the final document
  -- PDF as the last page.
  audit_trail_s3_key       TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_signatures_request
  ON public.document_signatures (signature_request_id, signed_at DESC);

ALTER TABLE public.document_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_signatures_all ON public.document_signatures;
CREATE POLICY document_signatures_all ON public.document_signatures
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

COMMENT ON TABLE public.document_signature_requests IS
  'W52 D1 — generic document e-sign requests. Linked to either a patient '
  '(EHR) or a reception lead (Reception-only). Signed PDF stored in S3.';

-- =============================================================================
-- Harbor RDS Postgres schema (parallel/aws-v1)
-- -----------------------------------------------------------------------------
-- Ported from Supabase. Removes:
--   * RLS policies  (enforced in the app layer via Cognito claims)
--   * auth.users references (replaced with Cognito sub stored as users.cognito_sub)
--   * storage.objects (replaced with S3 keys in the relevant tables)
--
-- Conventions:
--   * All primary keys are UUID v4, generated via gen_random_uuid().
--   * All timestamps are TIMESTAMPTZ with default now().
--   * Soft delete via deleted_at where applicable; no hard deletes for PHI.
--   * Longitudinal tables live alongside their base table.
--
-- Apply order: this file is idempotent — every CREATE uses IF NOT EXISTS.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- =============================================================================
-- Practices — the tenant root.
-- =============================================================================
CREATE TABLE IF NOT EXISTS practices (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                     TEXT NOT NULL,
    slug                     CITEXT UNIQUE,
    owner_email              CITEXT NOT NULL,
    phone                    TEXT,
    timezone                 TEXT NOT NULL DEFAULT 'America/Los_Angeles',

    -- Provisioning state
    provisioning_state       TEXT NOT NULL DEFAULT 'pending_payment'
        CHECK (provisioning_state IN (
            'pending_payment','provisioning','active','provisioning_failed','paused','cancelled'
        )),
    founding_member          BOOLEAN NOT NULL DEFAULT FALSE,

    -- Billing (Stripe)
    stripe_customer_id       TEXT,
    stripe_subscription_id   TEXT,
    stripe_price_id          TEXT,
    plan                     TEXT,

    -- Voice (Vapi + Twilio / SignalWire)
    vapi_assistant_id        TEXT,
    vapi_phone_number_id     TEXT,
    voice_provider           TEXT NOT NULL DEFAULT 'twilio'
        CHECK (voice_provider IN ('twilio','signalwire','retell','aws_chime')),
    twilio_phone_number      TEXT,
    twilio_phone_sid         TEXT,
    signalwire_number        TEXT,

    -- Crisis + messaging
    crisis_phone             TEXT,
    sms_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
    a2p_campaign_id          TEXT,

    -- Settings (dynamic system prompt inputs)
    greeting                 TEXT,
    specialties              TEXT[] NOT NULL DEFAULT '{}',
    hours                    JSONB NOT NULL DEFAULT '{}'::jsonb,
    accepts_insurance        BOOLEAN,
    accepted_insurance       TEXT[] NOT NULL DEFAULT '{}',
    cash_rate_cents          INTEGER,

    -- Integrations
    calendar_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    forward_calls_enabled    BOOLEAN NOT NULL DEFAULT FALSE,

    -- Timestamps
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_practices_state        ON practices(provisioning_state);
CREATE INDEX IF NOT EXISTS idx_practices_owner_email  ON practices(owner_email);
CREATE INDEX IF NOT EXISTS idx_practices_twilio_phone ON practices(twilio_phone_number);
CREATE INDEX IF NOT EXISTS idx_practices_vapi_phone   ON practices(vapi_phone_number_id);

-- =============================================================================
-- Users — Cognito-backed. cognito_sub is the link.
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cognito_sub    TEXT UNIQUE NOT NULL,
    email          CITEXT NOT NULL,
    full_name      TEXT,
    practice_id    UUID REFERENCES practices(id) ON DELETE CASCADE,
    role           TEXT NOT NULL DEFAULT 'clinician'
        CHECK (role IN ('owner','clinician','admin','support')),
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_practice ON users(practice_id);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);

-- =============================================================================
-- Patients — built from call data + intake. 28+ columns for longitudinal view.
-- =============================================================================
CREATE TABLE IF NOT EXISTS patients (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id                 UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,

    -- Identity
    first_name                  TEXT,
    last_name                   TEXT,
    preferred_name              TEXT,
    pronouns                    TEXT,
    date_of_birth               DATE,
    phone                       TEXT,
    email                       CITEXT,

    -- Demographics
    address_line_1              TEXT,
    address_line_2              TEXT,
    city                        TEXT,
    state                       TEXT,
    postal_code                 TEXT,
    country                     TEXT DEFAULT 'US',

    -- Clinical
    presenting_concerns         TEXT[],
    diagnoses                   TEXT[],
    current_medications         TEXT[],
    allergies                   TEXT[],
    risk_level                  TEXT CHECK (risk_level IN ('none','low','moderate','high','crisis')),

    -- Insurance
    insurance_provider          TEXT,
    insurance_member_id         TEXT,
    insurance_group_id          TEXT,
    insurance_verified_at       TIMESTAMPTZ,
    insurance_eligibility_json  JSONB,

    -- Status
    patient_status              TEXT NOT NULL DEFAULT 'inquiry'
        CHECK (patient_status IN ('inquiry','intake','active','paused','discharged','declined')),
    first_contact_at            TIMESTAMPTZ,
    last_contact_at             TIMESTAMPTZ,

    -- Emergency
    emergency_contact_name      TEXT,
    emergency_contact_phone     TEXT,
    emergency_contact_relation  TEXT,

    -- Consent
    sms_consent_granted         BOOLEAN NOT NULL DEFAULT FALSE,
    sms_consent_granted_at      TIMESTAMPTZ,
    hipaa_consent_granted_at    TIMESTAMPTZ,

    -- Audit
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_patients_practice         ON patients(practice_id);
CREATE INDEX IF NOT EXISTS idx_patients_phone            ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_email            ON patients(email);
CREATE INDEX IF NOT EXISTS idx_patients_status           ON patients(patient_status);
CREATE INDEX IF NOT EXISTS idx_patients_last_contact     ON patients(last_contact_at DESC);

-- =============================================================================
-- Call logs — every inbound/outbound call.
-- =============================================================================
CREATE TABLE IF NOT EXISTS call_logs (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id              UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    patient_id               UUID REFERENCES patients(id) ON DELETE SET NULL,

    -- Provider IDs
    vapi_call_id             TEXT UNIQUE,
    twilio_call_sid          TEXT,
    signalwire_call_id       TEXT,

    -- Parties
    direction                TEXT NOT NULL DEFAULT 'inbound'
        CHECK (direction IN ('inbound','outbound')),
    from_number              TEXT,
    to_number                TEXT,

    -- Timing
    started_at               TIMESTAMPTZ NOT NULL,
    ended_at                 TIMESTAMPTZ,
    duration_seconds         INTEGER,

    -- Outcome
    call_type                TEXT
        CHECK (call_type IN (
            'new_patient','existing_patient','scheduling','cancellation','billing','insurance','crisis','other'
        )),
    ended_reason             TEXT,
    booking_outcome          TEXT
        CHECK (booking_outcome IN ('booked','declined','no_fit','callback_requested','voicemail','none')),
    appointment_id           UUID,

    -- Content
    transcript               JSONB,
    summary                  TEXT,
    structured_summary       JSONB,
    sentiment                TEXT CHECK (sentiment IN ('positive','neutral','negative','distressed')),

    -- Crisis
    crisis_detected          BOOLEAN NOT NULL DEFAULT FALSE,
    crisis_tier              SMALLINT CHECK (crisis_tier BETWEEN 1 AND 3),

    -- Audit
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_practice         ON call_logs(practice_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_patient          ON call_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_vapi             ON call_logs(vapi_call_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_started          ON call_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_crisis           ON call_logs(practice_id, crisis_detected) WHERE crisis_detected = TRUE;

-- =============================================================================
-- Appointments — voice, dashboard, SMS-booked.
-- =============================================================================
CREATE TABLE IF NOT EXISTS appointments (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id             UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    patient_id              UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    call_log_id             UUID REFERENCES call_logs(id) ON DELETE SET NULL,

    -- Scheduling
    scheduled_for            TIMESTAMPTZ NOT NULL,
    duration_minutes         INTEGER NOT NULL DEFAULT 50,
    appointment_type         TEXT NOT NULL DEFAULT 'initial_consult'
        CHECK (appointment_type IN ('initial_consult','therapy','intake','followup','other')),

    -- Status
    status                   TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','confirmed','rescheduled','cancelled','no_show','completed')),
    booked_via               TEXT CHECK (booked_via IN ('voice','dashboard','sms','web','manual')),
    booked_by_user_id        UUID REFERENCES users(id),

    -- Calendar sync
    calendar_event_id        TEXT,
    calendar_connection_id   UUID,
    calendar_sync_status     TEXT DEFAULT 'pending'
        CHECK (calendar_sync_status IN ('pending','synced','failed','n/a')),
    calendar_sync_error      TEXT,

    -- Reminders
    reminder_sent_at         TIMESTAMPTZ,
    confirmation_sent_at     TIMESTAMPTZ,

    -- Notes
    notes                    TEXT,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_appts_practice_time   ON appointments(practice_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_appts_patient         ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appts_status          ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appts_calendar_event  ON appointments(calendar_event_id);

-- Fill the FK from call_logs → appointments now that appointments exists.
ALTER TABLE call_logs
  DROP CONSTRAINT IF EXISTS fk_call_logs_appointment;
ALTER TABLE call_logs
  ADD CONSTRAINT fk_call_logs_appointment
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;

-- =============================================================================
-- Intake forms — PHQ-9/GAD-7 via SMS.
-- =============================================================================
CREATE TABLE IF NOT EXISTS intake_forms (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id        UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    patient_id         UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    call_log_id        UUID REFERENCES call_logs(id) ON DELETE SET NULL,

    form_type          TEXT NOT NULL CHECK (form_type IN ('phq9','gad7','phq2','gad2','intake_demographics','custom')),
    status             TEXT NOT NULL DEFAULT 'sent'
        CHECK (status IN ('sent','opened','in_progress','completed','expired','cancelled')),

    sent_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opened_at          TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    expires_at         TIMESTAMPTZ,

    -- Raw answers + computed score
    answers            JSONB,
    score              INTEGER,
    severity           TEXT,

    -- Delivery
    link_token         TEXT UNIQUE,
    delivery_channel   TEXT DEFAULT 'sms' CHECK (delivery_channel IN ('sms','email','in_person')),

    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_practice  ON intake_forms(practice_id);
CREATE INDEX IF NOT EXISTS idx_intake_patient   ON intake_forms(patient_id);
CREATE INDEX IF NOT EXISTS idx_intake_status    ON intake_forms(status);

-- =============================================================================
-- Longitudinal — assessments over time.
-- =============================================================================
CREATE TABLE IF NOT EXISTS patient_assessments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id    UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    patient_id     UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    intake_form_id UUID REFERENCES intake_forms(id) ON DELETE SET NULL,

    assessment_type TEXT NOT NULL CHECK (assessment_type IN ('phq9','gad7','phq2','gad2','custom')),
    score           INTEGER NOT NULL,
    severity        TEXT,
    administered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administered_by UUID REFERENCES users(id),

    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessments_patient_time
    ON patient_assessments(patient_id, administered_at DESC);

-- =============================================================================
-- Longitudinal — unified communication timeline.
-- =============================================================================
CREATE TABLE IF NOT EXISTS patient_communications (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id    UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    patient_id     UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,

    channel        TEXT NOT NULL CHECK (channel IN ('call','sms','email','intake','in_person','note')),
    direction      TEXT CHECK (direction IN ('inbound','outbound','internal')),
    subject        TEXT,
    body           TEXT,

    -- Source references
    call_log_id    UUID REFERENCES call_logs(id) ON DELETE SET NULL,
    intake_form_id UUID REFERENCES intake_forms(id) ON DELETE SET NULL,
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,

    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comms_patient_time ON patient_communications(patient_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_practice     ON patient_communications(practice_id);

-- =============================================================================
-- Longitudinal — per-day practice analytics rollup.
-- =============================================================================
CREATE TABLE IF NOT EXISTS practice_analytics (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id           UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    day                   DATE NOT NULL,

    calls_inbound         INTEGER NOT NULL DEFAULT 0,
    calls_outbound        INTEGER NOT NULL DEFAULT 0,
    calls_missed          INTEGER NOT NULL DEFAULT 0,
    appointments_booked   INTEGER NOT NULL DEFAULT 0,
    appointments_cancelled INTEGER NOT NULL DEFAULT 0,
    new_patient_inquiries INTEGER NOT NULL DEFAULT 0,
    crisis_alerts_count   INTEGER NOT NULL DEFAULT 0,
    intake_forms_sent     INTEGER NOT NULL DEFAULT 0,
    intake_forms_completed INTEGER NOT NULL DEFAULT 0,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (practice_id, day)
);

CREATE INDEX IF NOT EXISTS idx_analytics_practice_day
    ON practice_analytics(practice_id, day DESC);

-- =============================================================================
-- Calendar connections (Google via CalDAV).
-- =============================================================================
CREATE TABLE IF NOT EXISTS calendar_connections (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id       UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    user_id           UUID REFERENCES users(id) ON DELETE SET NULL,

    provider          TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google','apple','outlook')),
    account_email     CITEXT NOT NULL,
    calendar_id       TEXT,

    access_token      TEXT NOT NULL,            -- encrypted at app layer via KMS
    refresh_token     TEXT NOT NULL,            -- encrypted at app layer via KMS
    expires_at        TIMESTAMPTZ,
    scopes            TEXT[],

    last_sync_at      TIMESTAMPTZ,
    last_error        TEXT,

    status            TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','expired','revoked','error')),

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_practice ON calendar_connections(practice_id);

-- Fill the FK from appointments → calendar_connections.
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS fk_appts_calendar_conn;
ALTER TABLE appointments
  ADD CONSTRAINT fk_appts_calendar_conn
    FOREIGN KEY (calendar_connection_id) REFERENCES calendar_connections(id) ON DELETE SET NULL;

-- =============================================================================
-- Crisis alerts.
-- =============================================================================
CREATE TABLE IF NOT EXISTS crisis_alerts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id         UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    patient_id          UUID REFERENCES patients(id) ON DELETE SET NULL,
    call_log_id         UUID REFERENCES call_logs(id) ON DELETE SET NULL,

    tier                SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 3),
    matched_phrases     TEXT[] NOT NULL DEFAULT '{}',
    transcript_snippet  TEXT,

    llm_verdict         TEXT CHECK (llm_verdict IN ('escalate_therapist','route_988','monitor','no_action')),
    llm_reasoning       TEXT,

    alert_sent_at       TIMESTAMPTZ,
    alert_recipient     TEXT,
    alert_channel       TEXT CHECK (alert_channel IN ('sms','email','call','dashboard')),
    acknowledged_at     TIMESTAMPTZ,
    acknowledged_by     UUID REFERENCES users(id),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crisis_practice_time ON crisis_alerts(practice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crisis_patient       ON crisis_alerts(patient_id);

-- =============================================================================
-- Session notes (clinician-authored SOAP notes).
-- =============================================================================
CREATE TABLE IF NOT EXISTS session_notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    practice_id     UUID NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
    patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    appointment_id  UUID REFERENCES appointments(id) ON DELETE SET NULL,
    author_user_id  UUID REFERENCES users(id),

    note_type       TEXT NOT NULL DEFAULT 'soap'
        CHECK (note_type IN ('soap','progress','intake','summary')),

    subjective      TEXT,
    objective       TEXT,
    assessment      TEXT,
    plan            TEXT,
    raw_text        TEXT,

    ai_drafted      BOOLEAN NOT NULL DEFAULT FALSE,
    signed_at       TIMESTAMPTZ,
    locked_at       TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_patient_time ON session_notes(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_practice     ON session_notes(practice_id);

-- =============================================================================
-- App settings (global feature flags).
-- =============================================================================
CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (key, value) VALUES
    ('signups_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- updated_at trigger (applied to tables with updated_at).
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'updated_at'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', t);
        EXECUTE format(
          'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          t
        );
    END LOOP;
END $$;

-- =============================================================================
-- End of schema.
-- =============================================================================

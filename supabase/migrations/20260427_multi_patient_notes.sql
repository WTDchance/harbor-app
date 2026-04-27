-- Wave 41 / T2 — multi-patient appointments + progress notes for
-- couples / family / ad-hoc group therapy.
--
-- Distinct from the existing ehr_group_sessions table (Wave 38),
-- which models closed-membership therapy groups with structured
-- attendance. This adds an arbitrary multi-patient concept on top
-- of the regular appointments + ehr_progress_notes flow:
--
--   - session_kind on appointment + note: individual | couples | family | group
--   - ehr_appointment_patients: M:N link with per-attendee role + present
--   - ehr_progress_note_patients: M:N link with per-attendee individual section
--
-- The legacy single-patient appointments.patient_id and
-- ehr_progress_notes.patient_id columns are PRESERVED — they still
-- carry the primary patient. Backfill inserts a 'primary' role row
-- in the join tables for every existing record so reads always see
-- a complete attendee list whether the appointment is individual
-- or multi-patient.

-- 1. session_kind on appointments.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS session_kind TEXT NOT NULL DEFAULT 'individual'
    CHECK (session_kind IN ('individual','couples','family','group'));

COMMENT ON COLUMN public.appointments.session_kind IS
  'Multi-patient session category. Individual is the default; couples/family/group '
  'imply ehr_appointment_patients carries the additional attendees. Distinct from '
  'appointment_type (initial_consult / therapy / etc.) which describes the visit '
  'type, not who attends.';

-- 2. session_kind on ehr_progress_notes.
ALTER TABLE public.ehr_progress_notes
  ADD COLUMN IF NOT EXISTS session_kind TEXT NOT NULL DEFAULT 'individual'
    CHECK (session_kind IN ('individual','couples','family','group'));

COMMENT ON COLUMN public.ehr_progress_notes.session_kind IS
  'Multi-patient note category. When != individual, ehr_progress_note_patients '
  'carries per-attendee individual sections + the SOAP/DAP/BIRP body holds the '
  'shared session narrative.';

-- 3. ehr_appointment_patients — M:N attendees for an appointment.
CREATE TABLE IF NOT EXISTS public.ehr_appointment_patients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  practice_id     UUID NOT NULL REFERENCES public.practices(id)    ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id)     ON DELETE CASCADE,

  -- 'primary' = the legacy single-patient anchor. Other roles are
  -- arbitrary descriptors useful for couples / family work.
  role            TEXT NOT NULL DEFAULT 'attendee'
                    CHECK (role IN ('primary','attendee','partner','parent','child','sibling','support','other')),

  present         BOOLEAN NOT NULL DEFAULT TRUE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (appointment_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_ap_patients_appointment
  ON public.ehr_appointment_patients (appointment_id);
CREATE INDEX IF NOT EXISTS idx_ap_patients_patient
  ON public.ehr_appointment_patients (patient_id, practice_id);

ALTER TABLE public.ehr_appointment_patients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ap_patients_select ON public.ehr_appointment_patients;
CREATE POLICY ap_patients_select ON public.ehr_appointment_patients
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS ap_patients_insert ON public.ehr_appointment_patients;
CREATE POLICY ap_patients_insert ON public.ehr_appointment_patients
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS ap_patients_update ON public.ehr_appointment_patients;
CREATE POLICY ap_patients_update ON public.ehr_appointment_patients
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS ap_patients_delete ON public.ehr_appointment_patients;
CREATE POLICY ap_patients_delete ON public.ehr_appointment_patients
  FOR DELETE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- 4. ehr_progress_note_patients — per-attendee individual sections
-- for couples/family notes. The note's main SOAP/DAP/BIRP body holds
-- the shared session narrative; this table holds private
-- per-attendee observations the therapist captured.
CREATE TABLE IF NOT EXISTS public.ehr_progress_note_patients (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id                  UUID NOT NULL REFERENCES public.ehr_progress_notes(id) ON DELETE CASCADE,
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id               UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  individual_note_section  TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (note_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_pnp_note ON public.ehr_progress_note_patients (note_id);
CREATE INDEX IF NOT EXISTS idx_pnp_patient ON public.ehr_progress_note_patients (patient_id, practice_id);

CREATE OR REPLACE FUNCTION public.pnp_touch() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_pnp_touch ON public.ehr_progress_note_patients;
CREATE TRIGGER trg_pnp_touch
  BEFORE UPDATE ON public.ehr_progress_note_patients
  FOR EACH ROW EXECUTE FUNCTION public.pnp_touch();

ALTER TABLE public.ehr_progress_note_patients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pnp_select ON public.ehr_progress_note_patients;
CREATE POLICY pnp_select ON public.ehr_progress_note_patients
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS pnp_insert ON public.ehr_progress_note_patients;
CREATE POLICY pnp_insert ON public.ehr_progress_note_patients
  FOR INSERT TO authenticated
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS pnp_update ON public.ehr_progress_note_patients;
CREATE POLICY pnp_update ON public.ehr_progress_note_patients
  FOR UPDATE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS pnp_delete ON public.ehr_progress_note_patients;
CREATE POLICY pnp_delete ON public.ehr_progress_note_patients
  FOR DELETE TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- 5. Backfill: every existing appointments + ehr_progress_notes row
-- gets a 'primary' join entry so reads always see complete attendee
-- lists. Idempotent (ON CONFLICT DO NOTHING via the unique index).
INSERT INTO public.ehr_appointment_patients (appointment_id, practice_id, patient_id, role)
SELECT id, practice_id, patient_id, 'primary'
  FROM public.appointments
 WHERE patient_id IS NOT NULL
ON CONFLICT (appointment_id, patient_id) DO NOTHING;

INSERT INTO public.ehr_progress_note_patients (note_id, practice_id, patient_id)
SELECT id, practice_id, patient_id
  FROM public.ehr_progress_notes
 WHERE patient_id IS NOT NULL
ON CONFLICT (note_id, patient_id) DO NOTHING;

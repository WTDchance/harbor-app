-- Wave 38 / TS6 — CPT codes and CMS modifiers on appointments.
--
-- A scheduled appointment can carry a primary CPT (procedure code) and
-- optional CMS modifiers (e.g. 95 for telehealth real-time interactive
-- audio+video). Both are nullable — code is selected at scheduling time
-- but can be changed at the point of service when the actual session
-- type is finalized.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS cpt_code TEXT,
  ADD COLUMN IF NOT EXISTS modifiers TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN public.appointments.cpt_code IS
  'Primary CPT procedure code planned for this appointment. Common values: '
  '90791 (initial diagnostic eval), 90834 (psychotherapy 45 min), '
  '90837 (psychotherapy 60 min), 90847 (family therapy with patient), '
  '90853 (group therapy), 90839 (psychotherapy for crisis 60 min). '
  'NULL until the therapist selects one.';

COMMENT ON COLUMN public.appointments.modifiers IS
  'Array of CMS HCPCS modifiers attached to this appointment. Modifier 95 '
  '(synchronous telehealth) is auto-applied when appointment_type=telehealth.';

-- Modifier 95 should be present whenever appointment_type='telehealth'.
-- Backfill existing telehealth appointments. Safe to re-run.
UPDATE public.appointments
   SET modifiers = ARRAY['95']::TEXT[]
 WHERE appointment_type = 'telehealth'
   AND NOT ('95' = ANY (modifiers));

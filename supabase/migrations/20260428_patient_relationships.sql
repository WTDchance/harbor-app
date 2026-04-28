-- Wave 44 / T3 — patient family relationships.
--
-- Many therapy practices treat families. Today the schema treats each
-- patient in isolation. This table tracks parent/guardian/spouse/etc
-- links between patients in the same practice so:
--   * the chart can surface a Family section
--   * minor-patient self-scheduling can require a parent/guardian
--     account to book on the minor's behalf
--   * ROI consents can target "the patient and any parent/guardian
--     on file" without re-listing each related party
--
-- Symmetry: when Mom is added as parent of Child, a sibling row is
-- inserted automatically with relationship='child' so a query from
-- Child sees Mom and a query from Mom sees Child without any caller-
-- side denormalization.

CREATE TABLE IF NOT EXISTS public.ehr_patient_relationships (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id        UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id         UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,
  related_patient_id UUID NOT NULL REFERENCES public.patients(id)  ON DELETE CASCADE,

  relationship       TEXT NOT NULL
                       CHECK (relationship IN (
                         'parent','guardian','spouse','partner',
                         'child','sibling','other'
                       )),

  -- True when this relationship gives `related_patient_id` consent
  -- authority over `patient_id`'s care. Typically true for parent/
  -- guardian of a minor; false for spouse/sibling.
  is_minor_consent   BOOLEAN NOT NULL DEFAULT FALSE,

  notes              TEXT,
  created_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Forbid self-references and dupes within (practice, patient, related,
  -- relationship). Same practice for both is enforced at the API layer.
  CONSTRAINT patient_relationships_no_self
    CHECK (patient_id <> related_patient_id),
  CONSTRAINT patient_relationships_unique
    UNIQUE (practice_id, patient_id, related_patient_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_patient_relationships_lookup
  ON public.ehr_patient_relationships (practice_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_patient_relationships_reverse
  ON public.ehr_patient_relationships (practice_id, related_patient_id);

ALTER TABLE public.ehr_patient_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_relationships_all ON public.ehr_patient_relationships;
CREATE POLICY patient_relationships_all ON public.ehr_patient_relationships
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Wave 38 / TS10 — Stanley-Brown Safety Plan structured 6-section fields.
--
-- The existing ehr_safety_plans table has arrays for each step (e.g.
-- warning_signs TEXT[], internal_coping TEXT[]). The Stanley-Brown
-- published 6-step model uses a single narrative free-text field per
-- section. We add normalized section_1..section_6 TEXT columns mirroring
-- the published headers.
--
-- The existing array columns are kept and remain valid — they are NOT
-- being dropped — so any existing data is preserved. Going forward the
-- form scaffold writes the section_*_text columns; reads can fall back
-- to the arrays joined with newlines if section_* is NULL.

ALTER TABLE public.ehr_safety_plans
  ADD COLUMN IF NOT EXISTS section_1_warning_signs           TEXT,
  ADD COLUMN IF NOT EXISTS section_2_internal_coping         TEXT,
  ADD COLUMN IF NOT EXISTS section_3_distraction_contacts    TEXT,
  ADD COLUMN IF NOT EXISTS section_4_help_contacts           TEXT,
  ADD COLUMN IF NOT EXISTS section_5_professionals_agencies  TEXT,
  ADD COLUMN IF NOT EXISTS section_6_means_restriction       TEXT;

COMMENT ON COLUMN public.ehr_safety_plans.section_1_warning_signs IS
  'Stanley-Brown step 1: Warning Signs. Free-text written collaboratively '
  'with the patient. Distinct from the warning_signs TEXT[] column which '
  'predates the structured form scaffold; both may be populated.';

COMMENT ON COLUMN public.ehr_safety_plans.section_6_means_restriction IS
  'Stanley-Brown step 6: Making the Environment Safer. Specific lethal-means '
  'reduction steps the patient agrees to take.';

-- Backfill: where a row has only the legacy array data and section_* is
-- NULL, copy a newline-joined version into the corresponding section so
-- existing safety plans render correctly in the new form.
UPDATE public.ehr_safety_plans
   SET
     section_1_warning_signs           = COALESCE(section_1_warning_signs,           array_to_string(warning_signs,            E'\n')),
     section_2_internal_coping         = COALESCE(section_2_internal_coping,         array_to_string(internal_coping,          E'\n')),
     section_3_distraction_contacts    = COALESCE(section_3_distraction_contacts,    array_to_string(distraction_people_places, E'\n')),
     section_6_means_restriction       = COALESCE(section_6_means_restriction,       means_restriction)
 WHERE section_1_warning_signs IS NULL
    OR section_2_internal_coping IS NULL
    OR section_3_distraction_contacts IS NULL
    OR section_6_means_restriction IS NULL;

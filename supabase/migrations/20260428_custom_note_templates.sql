-- Wave 44 / T5 — custom note templates per practice.
--
-- Built-in formats (SOAP / DAP / BIRP / GIRP / Narrative) cover most
-- therapists, but practices with a house style — trauma-recovery,
-- group-IFS, somatic, etc. — need named-section templates that don't
-- fit the built-in shapes. This table stores those templates with a
-- JSONB array of { key, label, helper } sections.
--
-- A note that uses a custom template stores its sections in a
-- separate ehr_progress_notes.custom_sections JSONB column (added
-- below) keyed by the template's section keys. note_format='custom'
-- in that case; the template_id is recorded so we can re-render the
-- labels even if the template is later edited.

CREATE TABLE IF NOT EXISTS public.ehr_note_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id  UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  name         TEXT NOT NULL,
  description  TEXT,

  -- Sections: an ordered array of { key, label, helper } objects.
  -- key is a stable identifier the note row uses to map values back;
  -- label is the user-facing field name; helper is optional placeholder
  -- copy ("What was the trigger?", etc.).
  sections     JSONB NOT NULL DEFAULT '[]'::JSONB,

  archived_at  TIMESTAMPTZ,
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_note_templates_practice_active
  ON public.ehr_note_templates (practice_id, archived_at)
  WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.ehr_note_templates_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ehr_note_templates_updated_at ON public.ehr_note_templates;
CREATE TRIGGER trg_ehr_note_templates_updated_at
  BEFORE UPDATE ON public.ehr_note_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.ehr_note_templates_touch_updated_at();

ALTER TABLE public.ehr_note_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS note_templates_all ON public.ehr_note_templates;
CREATE POLICY note_templates_all ON public.ehr_note_templates
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- ---------------------------------------------------------------------
-- Extend ehr_progress_notes to support custom formats.
-- ---------------------------------------------------------------------

ALTER TABLE public.ehr_progress_notes
  DROP CONSTRAINT IF EXISTS ehr_progress_notes_note_format_check;

ALTER TABLE public.ehr_progress_notes
  ADD CONSTRAINT ehr_progress_notes_note_format_check
  CHECK (note_format IN ('soap', 'dap', 'birp', 'girp', 'freeform', 'custom'));

ALTER TABLE public.ehr_progress_notes
  ADD COLUMN IF NOT EXISTS custom_template_id UUID
    REFERENCES public.ehr_note_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom_sections JSONB;

COMMENT ON COLUMN public.ehr_progress_notes.custom_template_id IS
  'NULL unless note_format=''custom''. Points at the template that '
  'defined this note''s section structure. ON DELETE SET NULL — '
  'deleting a template doesn''t orphan the notes; we still have the '
  'section keys + values stashed in custom_sections.';
COMMENT ON COLUMN public.ehr_progress_notes.custom_sections IS
  'JSONB { section_key: text } when note_format=''custom''. Section '
  'keys map to ehr_note_templates.sections[].key.';

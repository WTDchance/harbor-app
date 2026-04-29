-- Wave 49 / D4 — Calendar event types.
--
-- Replace the one-size-fits-all appointment with typed event types
-- (duration, CPT, modality, requires-intake-form, default location).
-- Seeds a sensible default set for every practice. Existing appointments
-- get backfilled to "Individual Therapy 50min" so historic data isn't
-- orphaned.

CREATE TABLE IF NOT EXISTS public.calendar_event_types (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id              UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  name                     TEXT NOT NULL,
  slug                     TEXT NOT NULL,
  color                    TEXT NOT NULL DEFAULT '#6b7280',
  default_duration_minutes INT  NOT NULL DEFAULT 50 CHECK (default_duration_minutes BETWEEN 5 AND 480),

  -- Array of CPT codes, e.g. ['90791'], ['90834','90837']
  default_cpt_codes        JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Optional: forces a specific custom intake form before first session.
  requires_intake_form_id  UUID REFERENCES public.practice_custom_forms(id) ON DELETE SET NULL,

  allows_telehealth        BOOLEAN NOT NULL DEFAULT TRUE,
  allows_in_person         BOOLEAN NOT NULL DEFAULT TRUE,
  default_location_id      UUID REFERENCES public.ehr_practice_locations(id) ON DELETE SET NULL,

  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_default               BOOLEAN NOT NULL DEFAULT FALSE,

  -- Sort order in pickers.
  sort_order               INT NOT NULL DEFAULT 0,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT calendar_event_types_slug_per_practice UNIQUE (practice_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_types_practice
  ON public.calendar_event_types (practice_id, status, sort_order);

CREATE OR REPLACE FUNCTION public.calendar_event_types_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calendar_event_types_updated_at ON public.calendar_event_types;
CREATE TRIGGER trg_calendar_event_types_updated_at
  BEFORE UPDATE ON public.calendar_event_types
  FOR EACH ROW EXECUTE FUNCTION public.calendar_event_types_touch();

ALTER TABLE public.calendar_event_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_event_types_all ON public.calendar_event_types;
CREATE POLICY calendar_event_types_all ON public.calendar_event_types
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));

-- Add the FK to appointments. NULL allowed during the transition window.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS event_type_id UUID REFERENCES public.calendar_event_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_event_type
  ON public.appointments (practice_id, event_type_id)
  WHERE event_type_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────
-- Seed defaults for every practice + backfill existing appointments.
-- ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  p RECORD;
  v_default_id UUID;
BEGIN
  FOR p IN SELECT id FROM public.practices LOOP
    -- Initial Consultation 15m
    INSERT INTO public.calendar_event_types
      (practice_id, name, slug, color, default_duration_minutes, default_cpt_codes,
       allows_telehealth, allows_in_person, sort_order, is_default)
    VALUES (p.id, 'Initial Consultation', 'initial-consult', '#6366f1', 15,
            '[]'::jsonb, TRUE, TRUE, 0, FALSE)
    ON CONFLICT (practice_id, slug) DO NOTHING;

    -- Intake 60m (90791)
    INSERT INTO public.calendar_event_types
      (practice_id, name, slug, color, default_duration_minutes, default_cpt_codes,
       allows_telehealth, allows_in_person, sort_order)
    VALUES (p.id, 'Intake', 'intake', '#0ea5e9', 60,
            '["90791"]'::jsonb, TRUE, TRUE, 10)
    ON CONFLICT (practice_id, slug) DO NOTHING;

    -- Individual Therapy 50m (90834) — designated default for backfill.
    INSERT INTO public.calendar_event_types
      (practice_id, name, slug, color, default_duration_minutes, default_cpt_codes,
       allows_telehealth, allows_in_person, sort_order, is_default)
    VALUES (p.id, 'Individual Therapy', 'individual-therapy', '#16a34a', 50,
            '["90834"]'::jsonb, TRUE, TRUE, 20, TRUE)
    ON CONFLICT (practice_id, slug) DO UPDATE SET is_default = TRUE
    RETURNING id INTO v_default_id;

    IF v_default_id IS NULL THEN
      SELECT id INTO v_default_id FROM public.calendar_event_types
        WHERE practice_id = p.id AND slug = 'individual-therapy' LIMIT 1;
    END IF;

    -- Couples Therapy 60m (90847)
    INSERT INTO public.calendar_event_types
      (practice_id, name, slug, color, default_duration_minutes, default_cpt_codes,
       allows_telehealth, allows_in_person, sort_order)
    VALUES (p.id, 'Couples Therapy', 'couples-therapy', '#db2777', 60,
            '["90847"]'::jsonb, TRUE, TRUE, 30)
    ON CONFLICT (practice_id, slug) DO NOTHING;

    -- Family Therapy 60m (90847)
    INSERT INTO public.calendar_event_types
      (practice_id, name, slug, color, default_duration_minutes, default_cpt_codes,
       allows_telehealth, allows_in_person, sort_order)
    VALUES (p.id, 'Family Therapy', 'family-therapy', '#a855f7', 60,
            '["90847"]'::jsonb, TRUE, TRUE, 40)
    ON CONFLICT (practice_id, slug) DO NOTHING;

    -- Group Therapy 90m (90853)
    INSERT INTO public.calendar_event_types
      (practice_id, name, slug, color, default_duration_minutes, default_cpt_codes,
       allows_telehealth, allows_in_person, sort_order)
    VALUES (p.id, 'Group Therapy', 'group-therapy', '#f59e0b', 90,
            '["90853"]'::jsonb, TRUE, TRUE, 50)
    ON CONFLICT (practice_id, slug) DO NOTHING;

    -- Med Management 30m (99213) — typically not a therapy CPT but keep slot
    INSERT INTO public.calendar_event_types
      (practice_id, name, slug, color, default_duration_minutes, default_cpt_codes,
       allows_telehealth, allows_in_person, sort_order)
    VALUES (p.id, 'Med Management', 'med-management', '#0d9488', 30,
            '["99213"]'::jsonb, TRUE, TRUE, 60)
    ON CONFLICT (practice_id, slug) DO NOTHING;

    -- Backfill any appointments missing event_type_id.
    UPDATE public.appointments a
       SET event_type_id = v_default_id
     WHERE a.practice_id = p.id AND a.event_type_id IS NULL AND v_default_id IS NOT NULL;
  END LOOP;
END$$;

COMMENT ON TABLE public.calendar_event_types IS
  'W49 D4 — typed appointment kinds with default duration, CPT codes, '
  'modality, intake-form requirement, and default location.';

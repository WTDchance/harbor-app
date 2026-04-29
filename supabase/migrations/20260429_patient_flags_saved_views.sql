-- Wave 49 / D5 — Patient flags + saved views.
--
-- Two surfaces:
--   * patient_flags         — chip-style status on a patient
--   * practice_saved_views  — shareable filtered patient lists
--
-- Both practice-scoped, both RLS-protected.

CREATE TABLE IF NOT EXISTS public.patient_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,

  type            TEXT NOT NULL CHECK (type IN (
                    'suicide_risk',
                    'no_show_risk',
                    'payment_risk',
                    'special_needs',
                    'vip',
                    'do_not_contact',
                    'minor',
                    'court_ordered',
                    'sliding_scale',
                    'language_other'
                  )),

  notes           TEXT,
  set_by_user_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  set_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at      TIMESTAMPTZ,
  cleared_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active (uncleared) flag of each type per patient at a time.
CREATE UNIQUE INDEX IF NOT EXISTS patient_flags_active_unique
  ON public.patient_flags (practice_id, patient_id, type)
  WHERE cleared_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_patient_flags_patient
  ON public.patient_flags (practice_id, patient_id, set_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_flags_type_active
  ON public.patient_flags (practice_id, type)
  WHERE cleared_at IS NULL;

ALTER TABLE public.patient_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS patient_flags_all ON public.patient_flags;
CREATE POLICY patient_flags_all ON public.patient_flags
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid()));


CREATE TABLE IF NOT EXISTS public.practice_saved_views (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id     UUID NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,

  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  scope           TEXT NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal', 'practice')),

  -- predicate tree (see lib/ehr/saved-views.ts) — { op, predicates }
  filter          JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- { field: 'last_visit_at'|'first_name'|...; direction: 'asc'|'desc' }
  sort            JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- columns the user wants visible — ordered array of column ids.
  columns         JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_views_practice
  ON public.practice_saved_views (practice_id, scope, name);
CREATE INDEX IF NOT EXISTS idx_saved_views_user
  ON public.practice_saved_views (practice_id, user_id, scope, name);

CREATE OR REPLACE FUNCTION public.practice_saved_views_touch()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_practice_saved_views_updated_at ON public.practice_saved_views;
CREATE TRIGGER trg_practice_saved_views_updated_at
  BEFORE UPDATE ON public.practice_saved_views
  FOR EACH ROW EXECUTE FUNCTION public.practice_saved_views_touch();

ALTER TABLE public.practice_saved_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practice_saved_views_select ON public.practice_saved_views;
CREATE POLICY practice_saved_views_select ON public.practice_saved_views
  FOR SELECT TO authenticated
  USING (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid())
         AND (scope = 'practice' OR user_id = auth.uid()));

DROP POLICY IF EXISTS practice_saved_views_modify ON public.practice_saved_views;
CREATE POLICY practice_saved_views_modify ON public.practice_saved_views
  FOR ALL TO authenticated
  USING      (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid())
              AND user_id = auth.uid())
  WITH CHECK (practice_id IN (SELECT practice_id FROM public.users WHERE id = auth.uid())
              AND user_id = auth.uid());

COMMENT ON TABLE public.patient_flags IS
  'W49 D5 — chip flags on a patient (suicide_risk, no_show_risk, …). '
  'Soft-cleared (cleared_at NOT NULL) for audit replay.';
COMMENT ON TABLE public.practice_saved_views IS
  'W49 D5 — shareable filter+sort+columns config for /dashboard/patients.';

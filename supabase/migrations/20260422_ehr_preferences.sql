-- UI preferences at the practice level. Stored as JSONB so we can evolve
-- the shape without migrations; the server normalizes against a canonical
-- defaults object on every read.
--
-- Shape (see lib/ehr/preferences.ts):
--   {
--     scale: 'solo' | 'small' | 'large',
--     metrics_depth: 'minimal' | 'standard' | 'power',
--     features: { telehealth, homework, mood_logs, safety_plans,
--                 treatment_plans, assessments, ai_draft,
--                 voice_dictation, audit_log, mandatory_reports,
--                 supervision, reports, billing, portal },
--     sidebar: { show_analytics, show_billing, compact }
--   }

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS ui_preferences JSONB NOT NULL DEFAULT '{}'::JSONB;

COMMENT ON COLUMN public.practices.ui_preferences IS
  'Practice-level UI preferences: scale (solo/small/large), metrics_depth '
  '(minimal/standard/power), and per-feature visibility toggles. Shape is '
  'normalized against defaults on every read (lib/ehr/preferences.ts).';

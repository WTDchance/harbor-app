-- Wave 46 / T6 — configurable dashboards + sidebars per therapist.
--
-- Each user picks which widgets show on Today and which modules
-- show in the left sidebar. Practice-level defaults are inherited
-- by new therapists; existing therapists keep what they had.
--
-- The actual widget/sidebar registry lives in
-- lib/ui/widget-registry.ts and lib/ui/sidebar-registry.ts.
-- These columns just store ordered arrays of registered IDs.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS dashboard_widgets JSONB,
  ADD COLUMN IF NOT EXISTS sidebar_modules   JSONB;

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS default_dashboard_widgets JSONB,
  ADD COLUMN IF NOT EXISTS default_sidebar_modules   JSONB;

COMMENT ON COLUMN public.users.dashboard_widgets IS
  'Ordered array of widget IDs the user wants on their Today screen. '
  'NULL = inherit practice default; unknown IDs are ignored at render '
  'time. The widget registry (lib/ui/widget-registry.ts) is the source '
  'of truth for valid IDs.';
COMMENT ON COLUMN public.users.sidebar_modules IS
  'Ordered array of sidebar module IDs the user wants visible. NULL = '
  'inherit practice default. required_role on the registry overrides '
  'visibility regardless of user preference.';
COMMENT ON COLUMN public.practices.default_dashboard_widgets IS
  'Practice default widget order for new therapists. NULL = use the '
  'application-wide default in lib/ui/widget-registry.ts::DEFAULT_LAYOUT.';
COMMENT ON COLUMN public.practices.default_sidebar_modules IS
  'Practice default sidebar module order. NULL = application-wide '
  'default.';

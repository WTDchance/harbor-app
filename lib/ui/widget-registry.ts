// lib/ui/widget-registry.ts
//
// W46 T6 — registry of dashboard widgets a therapist can show on
// Today. Each widget has a stable id (used as the JSONB key in
// users.dashboard_widgets) and a render path resolved client-side.
//
// New widgets are added by:
//   1. Append an entry to WIDGET_REGISTRY below
//   2. Mount the corresponding component in the Today screen
//      switch (app/dashboard/page.tsx renders by id).

export type WidgetId =
  | 'ai_brief'
  | 'needs_attention'
  | 'predictions'
  | 'tasks_today'
  | 'todays_schedule'
  | 'recent_activity'
  | 'engagement_trends'
  | 'mood_heatmap'

export interface WidgetMeta {
  id: WidgetId
  name: string
  description: string
  /** Default true = always available unless explicitly hidden. */
  default_on: boolean
}

export const WIDGET_REGISTRY: Record<WidgetId, WidgetMeta> = {
  ai_brief:        { id: 'ai_brief',        name: 'AI Morning Brief',
                     description: 'Sonnet reads the day in 90 seconds.',
                     default_on: true },
  needs_attention: { id: 'needs_attention', name: 'Needs attention',
                     description: 'Notes to sign, crisis flags, expiring consents.',
                     default_on: true },
  predictions:     { id: 'predictions',     name: 'Predictions',
                     description: 'No-show + dropout flags from W45 heuristics.',
                     default_on: true },
  tasks_today:     { id: 'tasks_today',     name: 'Tasks',
                     description: 'Tasks due today / this week.',
                     default_on: true },
  todays_schedule: { id: 'todays_schedule', name: "Today's schedule",
                     description: 'Appointment cards with quick actions.',
                     default_on: true },
  recent_activity: { id: 'recent_activity', name: 'Recent activity',
                     description: 'Last 10 patient interactions.',
                     default_on: true },
  engagement_trends: { id: 'engagement_trends', name: 'Engagement trends',
                       description: 'Caseload-wide engagement score trend.',
                       default_on: false },
  mood_heatmap:    { id: 'mood_heatmap',    name: 'Mood check-ins',
                     description: 'Caseload-wide 30-day mood heatmap from W46 T5 daily check-ins.',
                     default_on: false },
}

/** Application-wide default widget order. Used when a user has no
 *  preference saved AND the practice has no default. */
export const DEFAULT_WIDGET_LAYOUT: WidgetId[] = [
  'ai_brief',
  'needs_attention',
  'predictions',
  'tasks_today',
  'todays_schedule',
  'recent_activity',
]

/** Resolve the effective widget list for a user given their per-user
 *  preference and the practice default. Unknown IDs are dropped at
 *  render-time, not here, to keep this pure. */
export function resolveWidgetLayout(
  userPref: WidgetId[] | null | undefined,
  practiceDefault: WidgetId[] | null | undefined,
): WidgetId[] {
  if (Array.isArray(userPref) && userPref.length > 0) return userPref
  if (Array.isArray(practiceDefault) && practiceDefault.length > 0) return practiceDefault
  return DEFAULT_WIDGET_LAYOUT
}

export function isValidWidgetId(id: string): id is WidgetId {
  return Object.prototype.hasOwnProperty.call(WIDGET_REGISTRY, id)
}

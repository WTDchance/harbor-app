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
  // Wave 49 D6
  | 'today_needs_attention'
  | 'today_at_risk_patients'
  | 'next_7_days_revenue_projection'
  | 'expiring_licenses'
  | 'unpaid_claims_aging'

export type WidgetSize = '1x1' | '2x1' | '2x2'

export interface WidgetMeta {
  id: WidgetId
  name: string
  description: string
  /** Default true = always available unless explicitly hidden. */
  default_on: boolean
  /** Default cell-size on the dashboard grid. User can resize at render time. */
  default_size?: WidgetSize
  /** Default refresh interval (seconds). 0 = render-on-mount, no auto-refresh. */
  refresh_interval_seconds?: number
  /** Optional internal route the widget links into when clicked. */
  drilldown_path?: string
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
  // Wave 49 D6 — table-stakes catch-up widgets.
  today_needs_attention: {
    id: 'today_needs_attention',
    name: "Today — needs attention",
    description: 'Combined feed of unsigned notes, expiring consents, crisis flags, and stale tasks for today.',
    default_on: true,
    default_size: '2x1',
    refresh_interval_seconds: 60,
    drilldown_path: '/dashboard/ehr/tasks',
  },
  today_at_risk_patients: {
    id: 'today_at_risk_patients',
    name: 'Today — at-risk patients',
    description: 'Patients with active suicide_risk, no_show_risk, or payment_risk flags scheduled today.',
    default_on: true,
    default_size: '2x1',
    refresh_interval_seconds: 120,
    drilldown_path: '/dashboard/patients',
  },
  next_7_days_revenue_projection: {
    id: 'next_7_days_revenue_projection',
    name: 'Next 7 days — revenue projection',
    description: 'Projected revenue from booked appointments × CPT defaults across the next 7 days.',
    default_on: false,
    default_size: '2x1',
    refresh_interval_seconds: 600,
    drilldown_path: '/dashboard/ehr/billing',
  },
  expiring_licenses: {
    id: 'expiring_licenses',
    name: 'Expiring licenses',
    description: 'Therapist licenses expiring within 60 days, sorted by urgency.',
    default_on: false,
    default_size: '1x1',
    refresh_interval_seconds: 3600,
    drilldown_path: '/dashboard/settings',
  },
  unpaid_claims_aging: {
    id: 'unpaid_claims_aging',
    name: 'Unpaid claims — aging',
    description: 'Insurance claims open by 0-30 / 31-60 / 60+ day buckets.',
    default_on: false,
    default_size: '2x1',
    refresh_interval_seconds: 600,
    drilldown_path: '/dashboard/ehr/billing',
  },
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

// lib/ehr/preferences.ts
// Practice-level UI preferences. Source of truth for every "should this
// surface area show up for this practice?" question.
//
// Model: presets (scale × metrics_depth) set a baseline of feature flags.
// Individual toggles override the preset. The server always merges with
// DEFAULTS so older practices gain new features as we ship them, and
// newer flags default to sensible on/off per scale.

export type PracticeScale = 'solo' | 'small' | 'large'
export type MetricsDepth = 'minimal' | 'standard' | 'power'

export type FeatureFlags = {
  // Clinical surface
  assessments: boolean
  treatment_plans: boolean
  safety_plans: boolean
  mood_logs: boolean
  homework: boolean
  ai_draft: boolean
  voice_dictation: boolean
  // Operational
  telehealth: boolean
  portal: boolean
  mandatory_reports: boolean
  supervision: boolean
  // Admin / analytics
  reports: boolean
  audit_log: boolean
  billing: boolean
}

export type SidebarPrefs = {
  compact: boolean
  show_analytics: boolean
  show_billing: boolean
}

export type UiPreferences = {
  scale: PracticeScale
  metrics_depth: MetricsDepth
  features: FeatureFlags
  sidebar: SidebarPrefs
}

// ---------------------------------------------------------------------------
// Defaults — used when a field is missing from the row. Every feature defaults
// ON except the ones that only make sense for specific practice shapes
// (supervision for solo, for example).
// ---------------------------------------------------------------------------

const ALL_ON: FeatureFlags = {
  assessments: true,
  treatment_plans: true,
  safety_plans: true,
  mood_logs: true,
  homework: true,
  ai_draft: true,
  voice_dictation: true,
  telehealth: true,
  portal: true,
  mandatory_reports: true,
  supervision: true,
  reports: true,
  audit_log: true,
  billing: true,
}

const DEFAULTS: UiPreferences = {
  scale: 'solo',
  metrics_depth: 'standard',
  features: { ...ALL_ON },
  sidebar: { compact: false, show_analytics: true, show_billing: true },
}

// ---------------------------------------------------------------------------
// Presets — chosen by the practice in settings. Applies to features + sidebar.
// The therapist can still toggle individual flags after picking a preset.
// ---------------------------------------------------------------------------

type Preset = { scale: PracticeScale; metrics_depth: MetricsDepth; label: string; description: string; prefs: UiPreferences }

function pre(partial: Partial<UiPreferences>): UiPreferences {
  return {
    scale: partial.scale ?? DEFAULTS.scale,
    metrics_depth: partial.metrics_depth ?? DEFAULTS.metrics_depth,
    features: { ...ALL_ON, ...partial.features },
    sidebar: { ...DEFAULTS.sidebar, ...partial.sidebar },
  }
}

export const PRESETS: Preset[] = [
  {
    scale: 'solo',
    metrics_depth: 'minimal',
    label: 'Solo · Keep it simple',
    description: 'One clinician. Clinical tools front-and-center, no analytics clutter, no supervision queue. Mom-friendly.',
    prefs: pre({
      scale: 'solo', metrics_depth: 'minimal',
      features: { ...ALL_ON, reports: false, supervision: false, audit_log: false },
      sidebar: { compact: true, show_analytics: false, show_billing: true },
    }),
  },
  {
    scale: 'solo',
    metrics_depth: 'standard',
    label: 'Solo · Balanced',
    description: 'One clinician. Core clinical tools + a weekly practice-health dashboard. No supervision.',
    prefs: pre({
      scale: 'solo', metrics_depth: 'standard',
      features: { ...ALL_ON, supervision: false },
      sidebar: { compact: false, show_analytics: true, show_billing: true },
    }),
  },
  {
    scale: 'solo',
    metrics_depth: 'power',
    label: 'Solo · Data-driven',
    description: 'One clinician who loves metrics. Every graph, full audit log, every export surface.',
    prefs: pre({
      scale: 'solo', metrics_depth: 'power',
      features: { ...ALL_ON, supervision: false },
      sidebar: { compact: false, show_analytics: true, show_billing: true },
    }),
  },
  {
    scale: 'small',
    metrics_depth: 'standard',
    label: 'Small practice · Balanced',
    description: '2–10 clinicians. Supervision and co-signing on. Shared metrics dashboard. Balanced default.',
    prefs: pre({
      scale: 'small', metrics_depth: 'standard',
      features: { ...ALL_ON },
      sidebar: { compact: false, show_analytics: true, show_billing: true },
    }),
  },
  {
    scale: 'small',
    metrics_depth: 'power',
    label: 'Small practice · Data-driven',
    description: '2–10 clinicians. Full analytics, deep reporting, every admin surface unlocked.',
    prefs: pre({
      scale: 'small', metrics_depth: 'power',
      features: { ...ALL_ON },
      sidebar: { compact: false, show_analytics: true, show_billing: true },
    }),
  },
  {
    scale: 'large',
    metrics_depth: 'power',
    label: 'Large practice · Full operations',
    description: '10+ clinicians. Everything on. Admin-facing reports, supervision, department-level rollups, full audit.',
    prefs: pre({
      scale: 'large', metrics_depth: 'power',
      features: { ...ALL_ON },
      sidebar: { compact: false, show_analytics: true, show_billing: true },
    }),
  },
]

export function findPreset(scale: PracticeScale, depth: MetricsDepth): Preset | undefined {
  return PRESETS.find((p) => p.scale === scale && p.metrics_depth === depth)
}

/**
 * Merge a partial/raw row from practices.ui_preferences with defaults.
 * Forward-compatible: unknown keys are dropped, missing keys default to
 * sensible on/off.
 */
export function normalize(raw: any): UiPreferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS, features: { ...ALL_ON } }
  const scale: PracticeScale =
    raw.scale === 'small' || raw.scale === 'large' || raw.scale === 'solo' ? raw.scale : DEFAULTS.scale
  const depth: MetricsDepth =
    raw.metrics_depth === 'minimal' || raw.metrics_depth === 'power' || raw.metrics_depth === 'standard'
      ? raw.metrics_depth
      : DEFAULTS.metrics_depth
  const features: FeatureFlags = { ...ALL_ON }
  if (raw.features && typeof raw.features === 'object') {
    for (const k of Object.keys(features) as Array<keyof FeatureFlags>) {
      if (typeof raw.features[k] === 'boolean') features[k] = raw.features[k]
    }
  }
  const sidebar: SidebarPrefs = { ...DEFAULTS.sidebar }
  if (raw.sidebar && typeof raw.sidebar === 'object') {
    for (const k of Object.keys(sidebar) as Array<keyof SidebarPrefs>) {
      if (typeof raw.sidebar[k] === 'boolean') sidebar[k] = raw.sidebar[k]
    }
  }
  return { scale, metrics_depth: depth, features, sidebar }
}

export const DEFAULT_PREFERENCES = Object.freeze(DEFAULTS)

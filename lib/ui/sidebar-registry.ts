// lib/ui/sidebar-registry.ts
//
// W46 T6 — registry of left-sidebar nav modules.

export type SidebarModuleId =
  | 'today'
  | 'patients'
  | 'schedule'
  | 'inbox'
  | 'caseload'
  | 'notes'
  | 'tasks'
  | 'groups'
  | 'billing'
  | 'reports'
  | 'audit'
  | 'settings'
  // Wave 51 — reception-only navigation
  | 'reception_calls'
  | 'reception_leads'

// Practice product tier — drives which sidebar modules are visible.
export type ProductTier =
  | 'reception_only'
  | 'ehr_full'
  | 'ehr_only'
  | 'group_practice'
  | 'both'

/** Tiers that see the EHR clinical surface. */
export const EHR_TIERS: ProductTier[] = ['ehr_full', 'ehr_only', 'group_practice', 'both']
/** Tiers that see the Reception surface (every paying tier). */
export const RECEPTION_TIERS: ProductTier[] = ['reception_only', 'ehr_full', 'ehr_only', 'group_practice', 'both']

export type Role = 'therapist' | 'supervisor' | 'admin'

export interface SidebarMeta {
  id: SidebarModuleId
  label: string
  route: string
  /** Roles allowed to see this module regardless of user preference. */
  required_role?: Role
  /**
   * W51 — product tiers that may see this module. If absent, defaults to
   * the EHR tiers (so the legacy clinical modules don't accidentally
   * leak to reception_only practices).
   */
  required_tiers?: ProductTier[]
  default_on: boolean
}

export const SIDEBAR_REGISTRY: Record<SidebarModuleId, SidebarMeta> = {
  // Receptionist surface — every paying tier sees these.
  reception_calls: { id: 'reception_calls', label: 'Calls',    route: '/dashboard/receptionist/calls', default_on: true,  required_tiers: RECEPTION_TIERS },
  reception_leads: { id: 'reception_leads', label: 'Leads',    route: '/dashboard/receptionist/leads', default_on: true,  required_tiers: RECEPTION_TIERS },

  // Today / Patients / Schedule / Inbox — clinical-flavored, EHR tiers only.
  today:    { id: 'today',    label: 'Today',     route: '/dashboard',                              default_on: true,  required_tiers: EHR_TIERS },
  patients: { id: 'patients', label: 'Patients',  route: '/dashboard/patients',                     default_on: true,  required_tiers: EHR_TIERS },
  schedule: { id: 'schedule', label: 'Schedule',  route: '/dashboard/calendar',                     default_on: true,  required_tiers: EHR_TIERS },
  inbox:    { id: 'inbox',    label: 'Inbox',     route: '/dashboard/messages',                     default_on: true,  required_tiers: EHR_TIERS },
  caseload: { id: 'caseload', label: 'Caseload',  route: '/dashboard/ehr/caseload',                 default_on: true,  required_tiers: EHR_TIERS },
  notes:    { id: 'notes',    label: 'Notes',     route: '/dashboard/ehr/notes',                    default_on: true,  required_tiers: EHR_TIERS },
  tasks:    { id: 'tasks',    label: 'Tasks',     route: '/dashboard/ehr/tasks',                    default_on: true,  required_tiers: EHR_TIERS },
  groups:   { id: 'groups',   label: 'Groups',    route: '/dashboard/ehr/group-sessions',           default_on: false, required_tiers: EHR_TIERS },
  billing:  { id: 'billing',  label: 'Billing',   route: '/dashboard/ehr/billing',                  default_on: true,  required_tiers: EHR_TIERS },
  reports:  { id: 'reports',  label: 'Reports',   route: '/dashboard/ehr/reports',                  default_on: false, required_tiers: EHR_TIERS },
  audit:    { id: 'audit',    label: 'Audit',     route: '/dashboard/ehr/audit',                    required_role: 'admin', default_on: false, required_tiers: EHR_TIERS },

  // Settings — every tier sees Settings, but the page itself filters
  // sub-sections based on tier (calendar/voice/phone/billing for
  // reception_only; everything for EHR tiers).
  settings: { id: 'settings', label: 'Settings',  route: '/dashboard/settings',                     default_on: true,  required_tiers: RECEPTION_TIERS },
}

export const DEFAULT_SIDEBAR_LAYOUT: SidebarModuleId[] = [
  'today', 'patients', 'schedule', 'inbox', 'caseload',
  'notes', 'tasks', 'billing',
  'reception_calls', 'reception_leads',
  'settings',
]

export function resolveSidebarLayout(
  userPref: SidebarModuleId[] | null | undefined,
  practiceDefault: SidebarModuleId[] | null | undefined,
  role: Role = 'therapist',
  productTier: ProductTier = 'ehr_full',
): SidebarMeta[] {
  const ids = (Array.isArray(userPref) && userPref.length > 0)
    ? userPref
    : (Array.isArray(practiceDefault) && practiceDefault.length > 0)
      ? practiceDefault
      : DEFAULT_SIDEBAR_LAYOUT
  const ROLES_ORDERED: Role[] = ['therapist', 'supervisor', 'admin']
  const userRoleIdx = ROLES_ORDERED.indexOf(role)
  return ids
    .map((id) => SIDEBAR_REGISTRY[id])
    .filter((m): m is SidebarMeta => !!m)
    .filter((m) => {
      // role gate
      if (m.required_role) {
        const requiredIdx = ROLES_ORDERED.indexOf(m.required_role)
        if (userRoleIdx < requiredIdx) return false
      }
      // tier gate (W51) — default to EHR_TIERS if none specified
      const tiers = m.required_tiers ?? EHR_TIERS
      return tiers.includes(productTier)
    })
}

export function isValidSidebarId(id: string): id is SidebarModuleId {
  return Object.prototype.hasOwnProperty.call(SIDEBAR_REGISTRY, id)
}

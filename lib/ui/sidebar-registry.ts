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

export type Role = 'therapist' | 'supervisor' | 'admin'

export interface SidebarMeta {
  id: SidebarModuleId
  label: string
  route: string
  /** Roles allowed to see this module regardless of user preference. */
  required_role?: Role
  default_on: boolean
}

export const SIDEBAR_REGISTRY: Record<SidebarModuleId, SidebarMeta> = {
  today:    { id: 'today',    label: 'Today',     route: '/dashboard',                              default_on: true },
  patients: { id: 'patients', label: 'Patients',  route: '/dashboard/patients',                     default_on: true },
  schedule: { id: 'schedule', label: 'Schedule',  route: '/dashboard/calendar',                     default_on: true },
  inbox:    { id: 'inbox',    label: 'Inbox',     route: '/dashboard/messages',                     default_on: true },
  caseload: { id: 'caseload', label: 'Caseload',  route: '/dashboard/ehr/caseload',                 default_on: true },
  notes:    { id: 'notes',    label: 'Notes',     route: '/dashboard/ehr/notes',                    default_on: true },
  tasks:    { id: 'tasks',    label: 'Tasks',     route: '/dashboard/ehr/tasks',                    default_on: true },
  groups:   { id: 'groups',   label: 'Groups',    route: '/dashboard/ehr/group-sessions',           default_on: false },
  billing:  { id: 'billing',  label: 'Billing',   route: '/dashboard/ehr/billing',                  default_on: true },
  reports:  { id: 'reports',  label: 'Reports',   route: '/dashboard/ehr/reports',                  default_on: false },
  audit:    { id: 'audit',    label: 'Audit',     route: '/dashboard/ehr/audit',                    required_role: 'admin', default_on: false },
  settings: { id: 'settings', label: 'Settings',  route: '/dashboard/settings',                     default_on: true },
}

export const DEFAULT_SIDEBAR_LAYOUT: SidebarModuleId[] = [
  'today', 'patients', 'schedule', 'inbox', 'caseload',
  'notes', 'tasks', 'billing', 'settings',
]

export function resolveSidebarLayout(
  userPref: SidebarModuleId[] | null | undefined,
  practiceDefault: SidebarModuleId[] | null | undefined,
  role: Role = 'therapist',
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
      if (!m.required_role) return true
      const requiredIdx = ROLES_ORDERED.indexOf(m.required_role)
      return userRoleIdx >= requiredIdx
    })
}

export function isValidSidebarId(id: string): id is SidebarModuleId {
  return Object.prototype.hasOwnProperty.call(SIDEBAR_REGISTRY, id)
}

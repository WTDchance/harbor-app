// lib/ehr/patient-flags.ts
//
// W49 D5 — type definitions, display config, and a tiny SQL builder for
// the saved-views filter tree.

export const PATIENT_FLAG_TYPES = [
  'suicide_risk',
  'no_show_risk',
  'payment_risk',
  'special_needs',
  'vip',
  'do_not_contact',
  'minor',
  'court_ordered',
  'sliding_scale',
  'language_other',
] as const

export type PatientFlagType = typeof PATIENT_FLAG_TYPES[number]

export interface PatientFlagMeta {
  type: PatientFlagType
  label: string
  /** tailwind colour token (border, bg, text) */
  className: string
  /** non-zero severity for sorting; 3 = critical, 1 = informational */
  severity: 1 | 2 | 3
}

export const PATIENT_FLAG_META: Record<PatientFlagType, PatientFlagMeta> = {
  suicide_risk:    { type: 'suicide_risk',   label: 'Suicide risk',     className: 'border-red-300 bg-red-50 text-red-700',         severity: 3 },
  no_show_risk:    { type: 'no_show_risk',   label: 'No-show risk',     className: 'border-orange-300 bg-orange-50 text-orange-700', severity: 2 },
  payment_risk:    { type: 'payment_risk',   label: 'Payment risk',     className: 'border-amber-300 bg-amber-50 text-amber-700',   severity: 2 },
  special_needs:   { type: 'special_needs',  label: 'Special needs',    className: 'border-blue-300 bg-blue-50 text-blue-700',      severity: 1 },
  vip:             { type: 'vip',            label: 'VIP',              className: 'border-purple-300 bg-purple-50 text-purple-700', severity: 1 },
  do_not_contact:  { type: 'do_not_contact', label: 'Do not contact',   className: 'border-gray-400 bg-gray-100 text-gray-700',     severity: 3 },
  minor:           { type: 'minor',          label: 'Minor',            className: 'border-cyan-300 bg-cyan-50 text-cyan-700',      severity: 1 },
  court_ordered:   { type: 'court_ordered',  label: 'Court ordered',    className: 'border-indigo-300 bg-indigo-50 text-indigo-700', severity: 2 },
  sliding_scale:   { type: 'sliding_scale',  label: 'Sliding scale',    className: 'border-emerald-300 bg-emerald-50 text-emerald-700', severity: 1 },
  language_other:  { type: 'language_other', label: 'Other language',   className: 'border-teal-300 bg-teal-50 text-teal-700',      severity: 1 },
}

export function isPatientFlagType(s: unknown): s is PatientFlagType {
  return typeof s === 'string' && (PATIENT_FLAG_TYPES as readonly string[]).includes(s)
}

// ───────────────────────────────────────────────────────────────────
// SAVED-VIEW FILTER TREE → SQL
// ───────────────────────────────────────────────────────────────────
//
// Filter is a recursive predicate tree:
//   { op: 'and' | 'or', predicates: Predicate[] }
//   | { field, comparator, value }
//
// Comparators by field shape:
//   * strings: 'eq' | 'neq' | 'contains' | 'starts_with'
//   * numbers / dates: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
//   * booleans: 'is' | 'is_not'
//   * flag arrays: 'has_any' | 'has_all' | 'has_none'

export type Comparator =
  | 'eq' | 'neq' | 'contains' | 'starts_with'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'is' | 'is_not'
  | 'has_any' | 'has_all' | 'has_none'

export interface FilterLeaf {
  field: string
  comparator: Comparator
  value: unknown
}
export interface FilterGroup {
  op: 'and' | 'or'
  predicates: FilterNode[]
}
export type FilterNode = FilterLeaf | FilterGroup

export function isGroup(n: FilterNode): n is FilterGroup {
  return n != null && typeof n === 'object' && 'op' in n && Array.isArray((n as FilterGroup).predicates)
}

/** Whitelisted patient columns — anything else is rejected. */
export const FILTER_FIELDS: Record<string, { kind: 'text' | 'number' | 'bool' | 'date' | 'flag' | 'enum'; column: string }> = {
  'first_name':       { kind: 'text',   column: 'p.first_name' },
  'last_name':        { kind: 'text',   column: 'p.last_name' },
  'email':            { kind: 'text',   column: 'p.email' },
  'phone':            { kind: 'text',   column: 'p.phone' },
  'status':           { kind: 'text',   column: 'p.patient_status' },
  'risk_level':       { kind: 'text',   column: 'p.risk_level' },
  'created_at':       { kind: 'date',   column: 'p.created_at' },
  'last_contact_at':  { kind: 'date',   column: 'p.last_contact_at' },
  'first_contact_at': { kind: 'date',   column: 'p.first_contact_at' },
  'flags':            { kind: 'flag',   column: 'pf.types' }, // virtual via subquery
}

export interface BuildResult {
  whereSql: string
  params: unknown[]
  /** TRUE iff the filter touches the flags virtual column. */
  joinFlags: boolean
}

export function buildFilterSql(node: FilterNode | null | undefined, baseParams: unknown[] = []): BuildResult {
  const params = baseParams.slice()
  let joinFlags = false

  function emit(n: FilterNode | null | undefined): string {
    if (!n) return 'TRUE'
    if (isGroup(n)) {
      if (n.predicates.length === 0) return 'TRUE'
      const parts = n.predicates.map(emit).filter(p => p && p !== 'TRUE')
      if (parts.length === 0) return 'TRUE'
      return `(${parts.join(n.op === 'or' ? ' OR ' : ' AND ')})`
    }
    const meta = FILTER_FIELDS[n.field]
    if (!meta) return 'TRUE' // drop unknown silently — never a SQL error

    if (meta.kind === 'flag') {
      joinFlags = true
      const arr = Array.isArray(n.value) ? n.value.filter((s): s is string => typeof s === 'string' && (PATIENT_FLAG_TYPES as readonly string[]).includes(s)) : []
      if (arr.length === 0) return 'TRUE'
      params.push(arr)
      const idx = params.length
      switch (n.comparator) {
        case 'has_any':  return `${meta.column} && $${idx}::text[]`
        case 'has_all':  return `${meta.column} @> $${idx}::text[]`
        case 'has_none': return `NOT (${meta.column} && $${idx}::text[])`
        default:         return 'TRUE'
      }
    }

    if (meta.kind === 'text') {
      const v = n.value == null ? null : String(n.value)
      switch (n.comparator) {
        case 'eq':           params.push(v); return `${meta.column} = $${params.length}`
        case 'neq':          params.push(v); return `(${meta.column} IS DISTINCT FROM $${params.length})`
        case 'contains':     params.push(`%${(v ?? '').replace(/[%_]/g, m => `\\${m}`)}%`); return `${meta.column} ILIKE $${params.length}`
        case 'starts_with':  params.push(`${(v ?? '').replace(/[%_]/g, m => `\\${m}`)}%`); return `${meta.column} ILIKE $${params.length}`
        default:             return 'TRUE'
      }
    }

    if (meta.kind === 'number' || meta.kind === 'date') {
      const v = n.value
      if (v === null || v === undefined || v === '') return 'TRUE'
      const cmp: Record<string, string> = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' }
      const op = cmp[n.comparator]
      if (!op) return 'TRUE'
      params.push(v)
      return `${meta.column} ${op} $${params.length}`
    }

    if (meta.kind === 'bool') {
      const v = !!n.value
      params.push(v)
      return n.comparator === 'is_not'
        ? `(${meta.column} IS DISTINCT FROM $${params.length})`
        : `${meta.column} = $${params.length}`
    }
    return 'TRUE'
  }

  const where = emit(node ?? null)
  return { whereSql: where, params, joinFlags }
}

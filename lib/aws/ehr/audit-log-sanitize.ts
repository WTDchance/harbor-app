// lib/aws/ehr/audit-log-sanitize.ts
//
// Wave 40 / P2 — PHI sanitization for audit_logs CSV export.
//
// Audit-insertion helpers across the codebase put a mix of structured
// metadata into details JSONB. Most is non-PHI (counts, IDs, status
// transitions), but a handful of older write sites embed PHI:
//
//   app/api/admin/patients/[id]/route.ts      details.patient_name
//   app/api/admin/bootstrap-password/...      details.target_email,
//                                             details.attempted_email
//
// Cleaning the writers is a separate hygiene pass. This sanitizer is
// the second-line defence: redact PHI on the way out. Pure function.

const PHI_KEYS = new Set<string>([
  'patient_name', 'first_name', 'last_name', 'middle_name',
  'date_of_birth', 'dob', 'birth_date',
  'email', 'patient_email', 'target_email', 'attempted_email',
  'phone', 'patient_phone', 'home_phone', 'mobile_phone',
  'address', 'address_line_1', 'address_line_2',
  'ssn', 'social_security_number',
  'member_id', 'subscriber_id',
  'medication_list', 'diagnosis_text',
])

const REDACTED = '[REDACTED]'

export function sanitizeAuditDetails(details: unknown): unknown {
  return walk(details, 0)
}

function walk(value: unknown, depth: number): unknown {
  if (depth > 6 || value == null) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (PHI_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED
    } else {
      out[k] = walk(v, depth + 1)
    }
  }
  return out
}

export function sanitizeUserEmailForCsv(email: string | null): string {
  // Actor user_email is operationally needed in the export — we don't
  // redact it. PHI is patient-side data; clinician identity is the
  // point of the audit trail.
  return email ?? ''
}

/**
 * RFC-4180 minimal CSV cell escape.
 */
export function csvCell(v: unknown): string {
  if (v == null) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

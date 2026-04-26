// lib/aws/admin/payload-hash.ts
//
// Wave 18 — Every destructive admin endpoint audits a stable hash of
// the request body so a subsequent forensic review can prove what was
// asked for, even if the row is later mutated. We hash the canonicalized
// JSON (keys sorted, no whitespace) so two requests with the same
// semantic payload produce the same hash.
//
// The hash + admin email + target (practice_id / patient_id) is what
// goes into audit_logs.details. The raw payload is NOT stored — only
// the SHA-256 hex digest. If we need to verify a later allegation we
// can re-hash the asserted body and compare.

import { createHash } from 'node:crypto'

/**
 * Canonical JSON stringify — sorts object keys recursively, omits
 * whitespace. Arrays preserve order (semantically meaningful).
 * Special-cases for: null, NaN/Infinity normalize to null (matches
 * standard JSON.stringify behavior).
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null'
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']'
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]))
        .join(',') +
      '}'
    )
  }
  // Fallback for symbols / functions — should never happen in admin
  // payloads, but be defensive.
  return 'null'
}

/**
 * Stable SHA-256 hex digest of an arbitrary admin payload. Use in
 * audit_logs.details so a later forensic review can verify a claimed
 * payload by re-hashing it.
 */
export function hashAdminPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex')
}

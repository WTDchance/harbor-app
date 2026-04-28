// lib/ehr/stedi-pcn.ts
//
// Wave 41 / T5 patch — Stedi Patient Control Number generation +
// reserved-delimiter validation for the 837 JSON body.
//
// Reference: https://www.stedi.com/docs/healthcare/resubmit-cancel-claims
//
// Why this exists:
//   • Stedi requires patientControlNumber (PCN) to be ≤17 chars in
//     the X12 Basic charset (uppercase A–Z + digits 0–9). The
//     original W41 T5 used invoice.id (UUID) — invalid charset.
//   • Stedi rejects any 837 JSON body whose string values contain
//     the reserved delimiters `~ * : ^`. We strip/validate before
//     submission so the failure is a 422 with a useful field path
//     rather than an opaque 400 from Stedi.
//
// Both helpers are pure / framework-free so they can be imported
// from app/api routes (Next.js Edge ineligible — but submit paths
// already pin runtime='nodejs').

import { randomBytes } from 'node:crypto'

const PCN_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const PCN_LEN = 17

/**
 * Generate a 17-char X12-Basic-charset Patient Control Number.
 *
 * Backed by crypto.randomBytes — uniform over 36^17 ≈ 1.06e26
 * which is >2^86, plenty of headroom for collision-free PCNs at
 * any practice volume.
 */
export function generatePcn(): string {
  const buf = randomBytes(PCN_LEN)
  let out = ''
  for (let i = 0; i < PCN_LEN; i++) {
    out += PCN_CHARSET[buf[i] % PCN_CHARSET.length]
  }
  return out
}

/** True iff `s` is a 17-char Basic-charset PCN. */
export function isValidPcn(s: unknown): s is string {
  if (typeof s !== 'string') return false
  if (s.length !== PCN_LEN) return false
  for (let i = 0; i < s.length; i++) {
    if (!PCN_CHARSET.includes(s[i])) return false
  }
  return true
}

// X12 reserved delimiters that MUST NOT appear inside any string
// value of the 837 JSON body. Stedi returns 400 if they slip through.
//   ~ — segment terminator
//   * — element separator
//   : — composite separator
//   ^ — repetition separator
const RESERVED_DELIMS = new Set(['~', '*', ':', '^'])

export type StediBodyValidationIssue = {
  /** Dotted path into the body, e.g. `submitter.contactInformation.name` */
  path: string
  /** The reserved char that triggered the issue. */
  char: string
  /** A short snippet of the offending value (for log/debug; <=80 chars). */
  snippet: string
}

/**
 * Walk every string value in the 837 JSON body looking for X12
 * reserved delimiters. Returns the list of offending paths (empty
 * if clean). Caller decides whether to strip-and-retry, substitute,
 * or 422.
 *
 * Time complexity: O(total characters). The 837 body is small
 * (~5–20 KB) so this is negligible.
 */
export function validateStediBodyChars(body: unknown): StediBodyValidationIssue[] {
  const issues: StediBodyValidationIssue[] = []
  walk(body, '', issues)
  return issues
}

function walk(node: unknown, path: string, out: StediBodyValidationIssue[]): void {
  if (node == null) return
  if (typeof node === 'string') {
    for (const ch of node) {
      if (RESERVED_DELIMS.has(ch)) {
        out.push({
          path: path || '<root>',
          char: ch,
          snippet: node.length > 80 ? node.slice(0, 77) + '...' : node,
        })
        break // one issue per offending field is enough
      }
    }
    return
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walk(node[i], `${path}[${i}]`, out)
    }
    return
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walk(v, path ? `${path}.${k}` : k, out)
    }
  }
}

/**
 * Best-effort substitution: replace reserved delimiters in string
 * values with safe equivalents so the submission can proceed. Use
 * sparingly — the right thing is usually to surface the issue and
 * let the user clean the source data.
 *
 *   `~` → ' '
 *   `*` → ' '
 *   `:` → ' '
 *   `^` → ' '
 *
 * Returns a structurally-cloned, sanitized copy. Original is
 * untouched.
 */
export function sanitizeStediBody<T>(body: T): T {
  if (body == null) return body
  if (typeof body === 'string') {
    let s = body as string
    for (const ch of RESERVED_DELIMS) s = s.split(ch).join(' ')
    return s as unknown as T
  }
  if (Array.isArray(body)) {
    return body.map((x) => sanitizeStediBody(x)) as unknown as T
  }
  if (typeof body === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      out[k] = sanitizeStediBody(v)
    }
    return out as unknown as T
  }
  return body
}

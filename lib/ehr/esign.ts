// lib/ehr/esign.ts
//
// W52 D1 — helpers for the document e-signature flow.

import { randomBytes } from 'node:crypto'

export const ESIGN_CATEGORIES = [
  'hipaa_npp',
  'consent_for_treatment',
  'release_of_information',
  'telehealth_consent',
  'financial_responsibility',
  'treatment_plan',
  'other',
] as const
export type EsignCategory = typeof ESIGN_CATEGORIES[number]

export const ESIGN_DELIVERY = ['email', 'sms', 'both'] as const
export type EsignDeliveryChannel = typeof ESIGN_DELIVERY[number]

export const ESIGN_METHOD = ['typed', 'drawn', 'clicked'] as const
export type EsignMethod = typeof ESIGN_METHOD[number]

/**
 * Render a template body by replacing {{variable_name}} tokens with the
 * supplied context values. Unknown variables are left as a visible
 * placeholder string so the practice notices a missing field at preview
 * time rather than at signing time.
 */
export function renderTemplate(bodyHtml: string, ctx: Record<string, string | null | undefined>): string {
  return bodyHtml.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_, key: string) => {
    const value = ctx[key]
    if (value == null || value === '') return `[ ${key} ]`
    return String(value).replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] as string))
  })
}

export function newSignatureToken(): string {
  return 'sig_' + randomBytes(24).toString('base64url')
}

export function isLikelyDob(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/**
 * Identity verification helper: does the supplied DOB match what we have on
 * the linked patient/lead row? Verbatim string match is fine — both stored
 * as YYYY-MM-DD ISO dates.
 */
export function verifyIdentityByDob(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false
  const p = String(provided).trim()
  const e = String(expected).trim().slice(0, 10) // strip any time component
  return isLikelyDob(p) && isLikelyDob(e) && p === e
}

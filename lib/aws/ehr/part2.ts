// lib/aws/ehr/part2.ts
//
// Wave 41 — 42 CFR Part 2 consent helpers.
//
// 42 CFR Part 2 (federal SUD-records confidentiality rule) requires a
// written consent that contains a specific set of fields. Rather than
// pushing those fields into the DB schema as columns (which would lock
// us into one shape forever), we keep the existing generic
// consent_documents + consent_signatures tables and validate the
// structured fields at the API write boundary using the schema below.

export const PART2_KIND = '42_cfr_part2' as const

/**
 * Required keys in consent_signatures.metadata when kind = '42_cfr_part2'.
 * One of expiration_date or expiration_event must be present (not both
 * required; either satisfies the regulatory expiration requirement).
 */
export const PART2_REQUIRED_METADATA_KEYS = [
  'recipient_name',
  'recipient_address',
  'purpose_of_disclosure',
  'amount_and_kind_of_information',
  'patient_signature_date',
  'statement_of_revocation_right',
  'prohibition_on_redisclosure_notice',
] as const

export type Part2Metadata = {
  kind: typeof PART2_KIND
  recipient_name: string
  recipient_address: string
  purpose_of_disclosure: string
  amount_and_kind_of_information: string
  expiration_date?: string  // ISO date
  expiration_event?: string // e.g. "termination of treatment"
  patient_signature_date: string // ISO date
  statement_of_revocation_right: string
  prohibition_on_redisclosure_notice: string
}

/**
 * Boilerplate body_md template for a 42 CFR Part 2 consent document.
 * The recipient name and purpose are filled in at signing time via
 * metadata; the body_md itself is the legal frame.
 */
export const PART2_BODY_MD_TEMPLATE = `
# Consent for Disclosure of Substance Use Disorder Records (42 CFR Part 2)

This consent governs the disclosure of substance use disorder treatment
records protected by federal regulations at 42 CFR Part 2.

## Patient

The patient named on the accompanying signature record authorizes this
disclosure.

## Recipient

The records will be disclosed to the recipient named in the signature
metadata (recipient_name and recipient_address). Disclosure to any other
party is not authorized by this consent.

## Purpose of disclosure

The records may be used only for the specific purpose stated in the
signature metadata (purpose_of_disclosure). Disclosure for any other
purpose is not authorized.

## Amount and kind of information

Only the records described in the signature metadata
(amount_and_kind_of_information) are covered by this consent.

## Expiration

This consent expires on the date or upon the event specified in the
signature metadata (expiration_date or expiration_event), whichever
comes first.

## Right to revoke

The patient has the right to revoke this consent at any time, except to
the extent that action has already been taken in reliance on it.
Revocation must be made in writing or recorded by the practice.

## Prohibition on re-disclosure (42 CFR 2.32)

This information has been disclosed to you from records protected by
federal confidentiality rules (42 CFR Part 2). The federal rules
prohibit you from making any further disclosure of this information
unless further disclosure is expressly permitted by the written consent
of the person to whom it pertains or as otherwise permitted by 42 CFR
Part 2. A general authorization for the release of medical or other
information is NOT sufficient for this purpose. The federal rules
restrict any use of the information to investigate or prosecute with
regard to a crime any patient with a substance use disorder, except as
provided at 42 CFR 2.12(c)(5) and 2.65.
`.trim()

/**
 * The mandatory statutory re-disclosure prohibition notice. Travels with
 * every disclosure of Part 2 records — included in the PHI export
 * README, in the disclosure record, and surfaced to the patient on the
 * consent itself.
 */
export const PART2_REDISCLOSURE_NOTICE =
  'This information has been disclosed to you from records protected by ' +
  'federal confidentiality rules (42 CFR Part 2). The federal rules ' +
  'prohibit you from making any further disclosure of this information ' +
  'unless further disclosure is expressly permitted by the written ' +
  'consent of the person to whom it pertains or as otherwise permitted ' +
  'by 42 CFR Part 2.'

/**
 * Default revocation-right boilerplate. The application can override
 * this per-practice if needed; this is the minimum the rule requires.
 */
export const PART2_REVOCATION_RIGHT_BOILERPLATE =
  'You have the right to revoke this consent at any time, in writing, ' +
  'except to the extent that action has already been taken in reliance ' +
  'on it. Revocation does not affect any disclosures already made.'

/**
 * Validate a 42 CFR Part 2 metadata payload at API write time. Returns
 * a list of error messages — empty array means valid.
 */
export function validatePart2Metadata(
  raw: Record<string, unknown> | null | undefined,
): string[] {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') {
    return ['metadata required']
  }
  for (const k of PART2_REQUIRED_METADATA_KEYS) {
    const v = (raw as any)[k]
    if (typeof v !== 'string' || v.trim().length === 0) {
      errors.push(`metadata.${k} required`)
    }
  }
  const hasDate = typeof (raw as any).expiration_date === 'string'
    && (raw as any).expiration_date.trim().length > 0
  const hasEvent = typeof (raw as any).expiration_event === 'string'
    && (raw as any).expiration_event.trim().length > 0
  if (!hasDate && !hasEvent) {
    errors.push('metadata.expiration_date or metadata.expiration_event required')
  }
  return errors
}

/**
 * Decide whether a consent_signatures row is currently active for
 * Part 2 disclosure purposes — not revoked AND not past its expiration.
 */
export function isPart2SignatureActive(sig: {
  revoked_at: string | null
  metadata: Record<string, unknown> | null
}): boolean {
  if (sig.revoked_at) return false
  const md = sig.metadata || {}
  const expDate = (md as any).expiration_date as string | undefined
  if (expDate) {
    const t = Date.parse(expDate)
    if (Number.isFinite(t) && t < Date.now()) return false
  }
  // Event-based expiration is not auto-checked; the practice revokes
  // manually when the event occurs.
  return true
}

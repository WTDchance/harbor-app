// lib/aws/stedi/claim-submit-validate.ts
//
// Wave 41 / T5 — pre-flight validation for an 837 submission.
// Catches missing fields BEFORE we hit Stedi so we don't burn
// a control number / API call on a malformed claim.

export interface ClaimSubmitContext {
  practice: {
    id: string
    name: string | null
    npi: string | null
    billing_tax_id: string | null
  }
  patient: {
    id: string
    first_name: string | null
    last_name: string | null
    date_of_birth: string | null
    insurance_provider: string | null
    insurance_member_id: string | null
  }
  invoice: {
    id: string
    total_cents: number
    charge_ids: string[]
  }
  charges: Array<{
    id: string
    cpt_code: string | null
    icd10_codes: string[] | null
    units: number
    fee_cents: number
    service_date: string | null
  }>
  authorization?: {
    auth_number: string | null
    valid_from: string | null
    valid_to: string | null
  }
  payer_id_837: string | null
}

export interface ValidationIssue {
  code: string
  message: string
}

export function validateClaimContext(ctx: ClaimSubmitContext): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!ctx.practice.npi) issues.push({ code: 'practice_missing_npi', message: 'Practice has no NPI on file. Set practices.npi before submitting claims.' })
  if (!ctx.practice.billing_tax_id) issues.push({ code: 'practice_missing_tax_id', message: 'Practice has no billing tax ID on file.' })
  if (!ctx.practice.name) issues.push({ code: 'practice_missing_name', message: 'Practice has no name.' })

  if (!ctx.patient.first_name || !ctx.patient.last_name) {
    issues.push({ code: 'patient_missing_name', message: 'Patient first + last name required for 837.' })
  }
  if (!ctx.patient.date_of_birth) {
    issues.push({ code: 'patient_missing_dob', message: 'Patient date of birth required for 837.' })
  }
  if (!ctx.patient.insurance_provider) {
    issues.push({ code: 'patient_missing_insurance', message: 'Patient has no insurance provider on file.' })
  }
  if (!ctx.patient.insurance_member_id) {
    issues.push({ code: 'patient_missing_member_id', message: 'Patient has no insurance member ID on file.' })
  }

  if (!ctx.payer_id_837) {
    issues.push({
      code: 'payer_unresolved',
      message: 'Could not resolve payer ID for the 837. Map the patient\'s insurance_provider to a stedi_payers entry.',
    })
  }

  if (ctx.charges.length === 0) {
    issues.push({ code: 'invoice_no_charges', message: 'Invoice has no charges; nothing to submit.' })
  }

  for (const c of ctx.charges) {
    if (!c.cpt_code) issues.push({ code: 'charge_missing_cpt', message: `Charge ${c.id.slice(0, 8)}: CPT code required.` })
    if (!c.service_date) issues.push({ code: 'charge_missing_service_date', message: `Charge ${c.id.slice(0, 8)}: service_date required.` })
    if (!c.icd10_codes || c.icd10_codes.length === 0) {
      issues.push({
        code: 'charge_missing_diagnosis',
        message: `Charge ${c.id.slice(0, 8)}: at least one ICD-10 diagnosis required (link to a signed progress note with icd10_codes).`,
      })
    }
  }

  // Authorization is REQUIRED for in-network commercial claims that
  // gate on auth. We don't have a per-payer "auth required" flag yet,
  // so warn if not present rather than block.
  if (!ctx.authorization?.auth_number) {
    issues.push({
      code: 'auth_missing',
      message: 'No active insurance authorization found for the patient + CPT. If the payer requires pre-auth, the claim will be denied. Capture an auth via /dashboard/ehr/authorizations and retry.',
    })
  }

  return issues
}

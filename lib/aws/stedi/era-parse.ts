// lib/aws/stedi/era-parse.ts
//
// Wave 41 / T4 — parse a Stedi-normalized 835 ERA payload into the
// shape ehr_era_files + ehr_era_claim_payments expect.
//
// The Stedi 835 envelope is JSON-flattened from X12; the actual key
// names vary slightly across Stedi versions and across payers. We
// accept a small set of common shapes and fall back to defensible
// defaults so a malformed file still records a row (with parse_error
// set on the parent file) rather than 500'ing the webhook.

export interface ParsedClaimPayment {
  claim_reference: string | null
  patient_account_number: string | null
  payer_claim_control_no: string | null
  charge_amount_cents: number
  paid_amount_cents: number
  patient_responsibility_cents: number
  adjustments: unknown
  service_lines: unknown
  claim_status_code: string | null
}

export interface ParsedEra {
  payer_id: string | null
  payer_name: string | null
  check_or_eft_number: string | null
  payment_method: string | null
  payment_amount_cents: number
  payment_date: string | null  // ISO YYYY-MM-DD
  claims: ParsedClaimPayment[]
  parse_error: string | null
}

function dollarsToCents(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

function getString(obj: any, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

function ediDateToIso(s: unknown): string | null {
  if (typeof s !== 'string') return null
  // 'YYYYMMDD' (8 chars) or already ISO
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

export function parseStediEra(payload: any): ParsedEra {
  if (!payload || typeof payload !== 'object') {
    return {
      payer_id: null, payer_name: null,
      check_or_eft_number: null, payment_method: null,
      payment_amount_cents: 0, payment_date: null,
      claims: [],
      parse_error: 'payload not an object',
    }
  }

  const root = payload.transaction ?? payload.envelope ?? payload  // tolerate wrappers

  const payer = root.payer ?? root.payerInformation ?? {}
  const financial = root.financialInformation ?? root.bpr ?? {}
  const claims = (root.claims ?? root.claimPayments ?? []) as any[]

  const claimList: ParsedClaimPayment[] = (Array.isArray(claims) ? claims : []).map((c: any) => ({
    claim_reference:
      getString(c, 'claimReference', 'patientControlNumber', 'patientAccountNumber') ??
      getString(c?.identifier ?? {}, 'patientControlNumber') ??
      null,
    patient_account_number: getString(c, 'patientAccountNumber'),
    payer_claim_control_no: getString(c, 'payerClaimControlNumber', 'icn'),
    charge_amount_cents: dollarsToCents(c?.totalChargeAmount ?? c?.chargeAmount),
    paid_amount_cents:   dollarsToCents(c?.claimPaymentAmount ?? c?.paidAmount),
    patient_responsibility_cents: dollarsToCents(c?.patientResponsibilityAmount),
    adjustments:    c?.adjustments ?? c?.claimAdjustments ?? null,
    service_lines:  c?.serviceLines ?? c?.lineItems ?? null,
    claim_status_code: getString(c, 'claimStatusCode', 'statusCode'),
  }))

  return {
    payer_id: getString(payer, 'payerIdentifier', 'identificationCode'),
    payer_name: getString(payer, 'payerName', 'name'),
    check_or_eft_number: getString(financial, 'traceReferenceNumber', 'eftEffectiveDate', 'checkOrEftNumber'),
    payment_method: getString(financial, 'transactionHandlingCode', 'paymentMethod', 'paymentMethodCode'),
    payment_amount_cents: dollarsToCents(financial?.totalActualProviderPaymentAmount ?? financial?.paymentAmount),
    payment_date: ediDateToIso(
      financial?.checkIssueOrEffectiveDate ?? financial?.paymentDate ?? null,
    ),
    claims: claimList,
    parse_error: null,
  }
}

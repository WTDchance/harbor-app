// Shared Stedi 270/271 eligibility logic.
// One call path used by:
//   - POST /api/insurance/verify           (trigger_source: 'manual' | 'api')
//   - POST /api/intake/submit               (trigger_source: 'intake')
//   - /api/cron/eligibility-precheck        (trigger_source: 'batch_precheck')
//
// The function always persists an eligibility_checks row (even on failure) and
// advances the parent insurance_records cadence. Callers decide the auth client.

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolvePayerIdWithDb, payerAcceptsNameDobLookup } from './payers'

// 14 days between re-verifications. Short enough to catch mid-month lapses,
// long enough to keep batch volume sane.
const VERIFY_INTERVAL_DAYS = 14

export const STEDI_ELIGIBILITY_URL =
  'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3'

export type EligibilityStatus =
  | 'active'
  | 'inactive'
  | 'error'
  | 'manual_pending'
  | 'missing_data'

export type EligibilityTriggerSource =
  | 'manual'
  | 'api'
  | 'intake'
  | 'batch_precheck'

export interface EligibilityInput {
  /** Existing insurance_records.id. A row MUST exist before calling this. */
  insuranceRecordId: string
  practice: {
    id: string
    name: string | null
    npi: string | null
  }
  patient: {
    name: string
    dob: string | null        // YYYY-MM-DD
    phone?: string | null
  }
  insurance: {
    company: string | null
    memberId: string | null
    groupNumber?: string | null
    /** Override the payer-name lookup (for payers not in the built-in map). */
    payerIdOverride?: string | null
  }
  subscriber: {
    name?: string | null
    dob?: string | null       // YYYY-MM-DD
  }
  triggerSource: EligibilityTriggerSource
}

export interface EligibilityResult {
  status: EligibilityStatus
  insuranceRecordId: string
  payerId: string | null
  isActive: boolean | null
  mentalHealthCovered: boolean | null
  copayAmount: number | null
  coinsurancePercent: number | null
  deductibleTotal: number | null
  deductibleMet: number | null
  sessionLimit: number | null
  sessionsUsed: number | null
  priorAuthRequired: boolean | null
  planName: string | null
  coverageStartDate: string | null
  coverageEndDate: string | null
  errorMessage: string | null
  /** ID of the eligibility_checks row we just wrote. */
  eligibilityCheckId: string | null
}

/**
 * Run a 270/271 eligibility check and persist the result.
 *
 * Safe to call even when the Stedi key is missing or the record lacks a
 * member ID — it will record a `manual_pending` / `missing_data` row and
 * return a useful status so the caller can surface a message to the user.
 */
export async function runAndPersistEligibilityCheck(
  supabase: SupabaseClient,
  input: EligibilityInput
): Promise<EligibilityResult> {
  // Two-tier lookup: hardcoded map first, then full Stedi payer DB
  const payerId = await resolvePayerIdWithDb(supabase, input.insurance.company, input.insurance.payerIdOverride)
  const stediApiKey = process.env.STEDI_API_KEY

  // ---- short-circuits: persist a row, return, don't burn a Stedi call ----
  if (!stediApiKey) {
    return persistShortCircuit(supabase, input, payerId, 'manual_pending',
      'STEDI_API_KEY not configured')
  }

  if (!payerId) {
    return persistShortCircuit(supabase, input, null, 'manual_pending',
      `Unknown payer "${input.insurance.company ?? ''}". Provide a payer ID override.`)
  }

  const canUseNameDobOnly = payerAcceptsNameDobLookup(payerId)
  const hasMemberId = !!input.insurance.memberId?.trim()
  const hasNameAndDob = !!(input.patient.name?.trim() && input.patient.dob)

  if (!hasMemberId && !(canUseNameDobOnly && hasNameAndDob)) {
    return persistShortCircuit(supabase, input, payerId, 'missing_data',
      'Missing member ID. Required for this payer.')
  }

  // ---- build 270 payload ----
  const payload = buildStediPayload(input, payerId)

  let stediResponse: any = null
  let httpOk = false
  try {
    const res = await fetch(STEDI_ELIGIBILITY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${stediApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    httpOk = res.ok
    stediResponse = await res.json().catch(() => null)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error calling Stedi'
    return persistResult(supabase, input, payerId, {
      status: 'error',
      errorMessage: message,
      raw: null,
      parsed: emptyParsed(),
    })
  }

  if (!httpOk) {
    const errMsg =
      stediResponse?.message ||
      stediResponse?.error ||
      `Stedi returned HTTP error for member ${input.insurance.memberId ?? 'N/A'}`
    return persistResult(supabase, input, payerId, {
      status: 'error',
      errorMessage: errMsg,
      raw: stediResponse,
      parsed: emptyParsed(),
    })
  }

  const parsed = parseStedi271(stediResponse)
  const status: EligibilityStatus = parsed.isActive ? 'active' : 'inactive'
  return persistResult(supabase, input, payerId, {
    status,
    errorMessage: null,
    raw: stediResponse,
    parsed,
  })
}

// ----------------------------------------------------------------------------
// internals
// ----------------------------------------------------------------------------

interface ParsedBenefits {
  isActive: boolean | null
  mentalHealthCovered: boolean | null
  copayAmount: number | null
  coinsurancePercent: number | null
  deductibleTotal: number | null
  deductibleMet: number | null
  sessionLimit: number | null
  sessionsUsed: number | null
  priorAuthRequired: boolean | null
  planName: string | null
  coverageStartDate: string | null
  coverageEndDate: string | null
}

function emptyParsed(): ParsedBenefits {
  return {
    isActive: null,
    mentalHealthCovered: null,
    copayAmount: null,
    coinsurancePercent: null,
    deductibleTotal: null,
    deductibleMet: null,
    sessionLimit: null,
    sessionsUsed: null,
    priorAuthRequired: null,
    planName: null,
    coverageStartDate: null,
    coverageEndDate: null,
  }
}

function buildStediPayload(input: EligibilityInput, payerId: string) {
  const controlNumber = Date.now().toString().slice(-9).padStart(9, '0')
  const dobFormatted = (input.patient.dob || '').replace(/-/g, '') // YYYYMMDD
  const [firstName, ...restName] = (input.subscriber.name || input.patient.name || '')
    .trim()
    .split(/\s+/)
  const lastName = restName.join(' ')

  return {
    controlNumber,
    tradingPartnerServiceId: payerId,
    provider: {
      organizationName: input.practice.name || 'Harbor Practice',
      npi: input.practice.npi || '0000000000',
    },
    subscriber: {
      memberId: input.insurance.memberId || undefined,
      firstName: firstName || 'PATIENT',
      lastName: lastName || 'UNKNOWN',
      dateOfBirth: dobFormatted,
    },
    encounter: {
      // 30 = Health Benefit Plan Coverage (general active/inactive probe)
      // MH = Mental Health
      serviceTypeCodes: ['30', 'MH'],
      dateOfService: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    },
  }
}

/**
 * Best-effort 271 parse. Stedi normalizes most fields into `benefitsInformation[]`
 * with EDI code-set values. Field shapes vary per payer, so every extraction is
 * defensive — the canonical record is `raw_response` for later re-parsing.
 *
 * EDI benefit codes we care about:
 *   '1'  active coverage         '6'  inactive
 *   'B'  copayment               'A'  coinsurance
 *   'C'  deductible              'G'  out-of-pocket
 *   'F'  limitations             'X'  out-of-network
 */
function parseStedi271(data: any): ParsedBenefits {
  const benefits: any[] = Array.isArray(data?.benefitsInformation) ? data.benefitsInformation : []

  const mentalHealth = benefits.filter((b: any) => {
    const codes: string[] = b?.serviceTypeCodes || []
    return codes.includes('MH') || codes.includes('30') || codes.includes('A4') ||
      (b?.serviceTypeDescription || '').toLowerCase().includes('mental')
  })

  // EDI active status codes:
  //   '1' = Active Coverage
  //   '2' = Active - Full Risk Capitation (used by Medicaid CCOs like Cascade Health Alliance)
  // We check ALL planStatus entries, not just [0], because payers return multiple
  // plan lines and the active one may not be first.
  const ACTIVE_STATUS_CODES = new Set(['1', '2'])
  const planStatuses: any[] = Array.isArray(data?.planStatus) ? data.planStatus : []
  const activePlan = planStatuses.find((ps: any) => ACTIVE_STATUS_CODES.has(ps?.statusCode))
  const isActive =
    !!activePlan ||
    benefits.some((b: any) => ACTIVE_STATUS_CODES.has(b?.code) && b?.serviceTypeCodes?.some(
      (c: string) => c === '30' || c === 'MH' || c === 'A4'
    ))

  const copayRaw = mentalHealth.find((b: any) => b?.code === 'B' && b?.benefitAmount)?.benefitAmount
  const coinsuranceRaw = mentalHealth.find((b: any) => b?.code === 'A' && b?.benefitPercent)?.benefitPercent
  const deductibleTotal = mentalHealth.find((b: any) =>
    b?.code === 'C' &&
    (b?.timeQualifierCode === '29' || (b?.benefitsServiceLine || '').toLowerCase().includes('year'))
  )?.benefitAmount
  const deductibleMet = mentalHealth.find((b: any) =>
    b?.code === 'C' && (b?.inPlanNetworkIndicator === 'Y' || b?.benefitsDateInformation?.spendDown)
  )?.benefitAmount

  const limitation = mentalHealth.find((b: any) => b?.code === 'F' && b?.benefitQuantity)
  const sessionLimit = limitation?.benefitQuantity ? parseInt(limitation.benefitQuantity, 10) : null

  const priorAuthRequired = mentalHealth.some((b: any) =>
    b?.authOrCertIndicator === 'Y' ||
    (b?.eligibilityOrBenefit || '').toLowerCase().includes('prior auth')
  ) || null

  const coverageDates = data?.planDateInformation || {}

  return {
    isActive: typeof isActive === 'boolean' ? isActive : null,
    mentalHealthCovered: mentalHealth.length > 0,
    copayAmount: toNum(copayRaw),
    coinsurancePercent: toNum(coinsuranceRaw),
    deductibleTotal: toNum(deductibleTotal),
    deductibleMet: toNum(deductibleMet),
    sessionLimit,
    sessionsUsed: null, // Not reliably surfaced by all payers; display session_limit only
    priorAuthRequired,
    planName: activePlan?.planDetails || activePlan?.statusDescription || planStatuses[0]?.planDetails || data?.planInformation?.planDescription || null,
    coverageStartDate: edi8ToDate(coverageDates?.planBegin || coverageDates?.eligibilityBegin),
    coverageEndDate: edi8ToDate(coverageDates?.planEnd || coverageDates?.eligibilityEnd),
  }
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

function edi8ToDate(s: unknown): string | null {
  if (typeof s !== 'string' || !/^\d{8}$/.test(s)) return null
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

async function persistShortCircuit(
  supabase: SupabaseClient,
  input: EligibilityInput,
  payerId: string | null,
  status: Extract<EligibilityStatus, 'manual_pending' | 'missing_data'>,
  reason: string
): Promise<EligibilityResult> {
  return persistResult(supabase, input, payerId, {
    status,
    errorMessage: reason,
    raw: null,
    parsed: emptyParsed(),
  })
}

async function persistResult(
  supabase: SupabaseClient,
  input: EligibilityInput,
  payerId: string | null,
  ctx: {
    status: EligibilityStatus
    errorMessage: string | null
    raw: unknown
    parsed: ParsedBenefits
  }
): Promise<EligibilityResult> {
  const { parsed } = ctx
  const nowIso = new Date().toISOString()
  const nextDueIso = new Date(Date.now() + VERIFY_INTERVAL_DAYS * 86_400_000).toISOString()

  const { data: inserted, error: insertErr } = await supabase
    .from('eligibility_checks')
    .insert({
      insurance_record_id: input.insuranceRecordId,
      practice_id: input.practice.id,
      status: ctx.status,
      is_active: parsed.isActive,
      mental_health_covered: parsed.mentalHealthCovered,
      copay_amount: parsed.copayAmount,
      coinsurance_percent: parsed.coinsurancePercent,
      deductible_total: parsed.deductibleTotal,
      deductible_met: parsed.deductibleMet,
      session_limit: parsed.sessionLimit,
      sessions_used: parsed.sessionsUsed,
      prior_auth_required: parsed.priorAuthRequired,
      plan_name: parsed.planName,
      coverage_start_date: parsed.coverageStartDate,
      coverage_end_date: parsed.coverageEndDate,
      payer_id: payerId,
      trigger_source: input.triggerSource,
      raw_response: ctx.raw,
      error_message: ctx.errorMessage,
      checked_at: nowIso,
    })
    .select('id')
    .single()

  // Advance the parent record's cadence even on soft failures so batch doesn't
  // re-hit a broken record every run. Hard errors still update timestamp so we
  // can see when the last attempt happened.
  try {
    await supabase
      .from('insurance_records')
      .update({
        last_verified_at: nowIso,
        last_verification_status: ctx.status,
        next_verify_due: nextDueIso,
        updated_at: nowIso,
      })
      .eq('id', input.insuranceRecordId)
  } catch (err) {
    console.error('[stedi] failed to update insurance_records cadence', err)
  }

  if (insertErr) {
    console.error('[stedi] failed to persist eligibility_checks row', insertErr)
  }

  return {
    status: ctx.status,
    insuranceRecordId: input.insuranceRecordId,
    payerId,
    isActive: parsed.isActive,
    mentalHealthCovered: parsed.mentalHealthCovered,
    copayAmount: parsed.copayAmount,
    coinsurancePercent: parsed.coinsurancePercent,
    deductibleTotal: parsed.deductib
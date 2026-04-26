// Shared Stedi 270/271 eligibility logic — AWS port via pool.
//
// One call path used by:
//   - POST /api/insurance/verify           (trigger_source: 'manual' | 'api')
//   - POST /api/intake/submit               (trigger_source: 'intake')
//   - /api/cron/eligibility-precheck        (trigger_source: 'batch_precheck')
//
// Always persists an eligibility_checks row (even on failure) and advances
// the parent insurance_records cadence.

import { pool } from '@/lib/aws/db'
import { resolvePayerIdWithDb, payerAcceptsNameDobLookup } from './payers'

const VERIFY_INTERVAL_DAYS = 14

export const STEDI_ELIGIBILITY_URL =
  'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3'

export type EligibilityStatus =
  | 'active' | 'inactive' | 'error' | 'manual_pending' | 'missing_data'

export type EligibilityTriggerSource =
  | 'manual' | 'api' | 'intake' | 'batch_precheck'

export interface EligibilityInput {
  insuranceRecordId: string
  practice: { id: string; name: string | null; npi: string | null }
  patient: { name: string; dob: string | null; phone?: string | null }
  insurance: {
    company: string | null
    memberId: string | null
    groupNumber?: string | null
    payerIdOverride?: string | null
  }
  subscriber: { name?: string | null; dob?: string | null }
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
  eligibilityCheckId: string | null
}

export async function runAndPersistEligibilityCheck(
  input: EligibilityInput,
): Promise<EligibilityResult> {
  const payerId = await resolvePayerIdWithDb(
    input.insurance.company,
    input.insurance.payerIdOverride,
  )
  const stediApiKey = process.env.STEDI_API_KEY

  if (!stediApiKey) {
    return persistShortCircuit(input, payerId, 'manual_pending', 'STEDI_API_KEY not configured')
  }
  if (!payerId) {
    return persistShortCircuit(
      input, null, 'manual_pending',
      `Unknown payer "${input.insurance.company ?? ''}". Provide a payer ID override.`,
    )
  }

  const canUseNameDobOnly = payerAcceptsNameDobLookup(payerId)
  const hasMemberId = !!input.insurance.memberId?.trim()
  const hasNameAndDob = !!(input.patient.name?.trim() && input.patient.dob)

  if (!hasMemberId && !(canUseNameDobOnly && hasNameAndDob)) {
    return persistShortCircuit(input, payerId, 'missing_data',
      'Missing member ID. Required for this payer.')
  }

  const payload = buildStediPayload(input, payerId)

  let stediResponse: any = null
  let httpOk = false
  try {
    const res = await fetch(STEDI_ELIGIBILITY_URL, {
      method: 'POST',
      headers: { 'Authorization': `Key ${stediApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    httpOk = res.ok
    stediResponse = await res.json().catch(() => null)
  } catch (err) {
    return persistResult(input, payerId, {
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'Network error calling Stedi',
      raw: null, parsed: emptyParsed(),
    })
  }

  if (!httpOk) {
    const errMsg =
      stediResponse?.message || stediResponse?.error ||
      `Stedi returned HTTP error for member ${input.insurance.memberId ?? 'N/A'}`
    return persistResult(input, payerId, {
      status: 'error', errorMessage: errMsg, raw: stediResponse, parsed: emptyParsed(),
    })
  }

  const parsed = parseStedi271(stediResponse)
  const status: EligibilityStatus = parsed.isActive ? 'active' : 'inactive'
  return persistResult(input, payerId, {
    status, errorMessage: null, raw: stediResponse, parsed,
  })
}

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
    isActive: null, mentalHealthCovered: null, copayAmount: null,
    coinsurancePercent: null, deductibleTotal: null, deductibleMet: null,
    sessionLimit: null, sessionsUsed: null, priorAuthRequired: null,
    planName: null, coverageStartDate: null, coverageEndDate: null,
  }
}

function buildStediPayload(input: EligibilityInput, payerId: string) {
  const controlNumber = Date.now().toString().slice(-9).padStart(9, '0')
  const dobFormatted = (input.patient.dob || '').replace(/-/g, '')
  const [firstName, ...restName] = (input.subscriber.name || input.patient.name || '')
    .trim().split(/\s+/)
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
      serviceTypeCodes: ['30', 'MH'],
      dateOfService: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    },
  }
}

function parseStedi271(data: any): ParsedBenefits {
  const benefits: any[] = Array.isArray(data?.benefitsInformation) ? data.benefitsInformation : []
  const mentalHealth = benefits.filter((b: any) => {
    const codes: string[] = b?.serviceTypeCodes || []
    return codes.includes('MH') || codes.includes('30') || codes.includes('A4') ||
      (b?.serviceTypeDescription || '').toLowerCase().includes('mental')
  })

  const ACTIVE_STATUS_CODES = new Set(['1', '2'])
  const planStatuses: any[] = Array.isArray(data?.planStatus) ? data.planStatus : []
  const activePlan = planStatuses.find((ps: any) => ACTIVE_STATUS_CODES.has(ps?.statusCode))
  const isActive =
    !!activePlan ||
    benefits.some((b: any) =>
      ACTIVE_STATUS_CODES.has(b?.code) &&
      b?.serviceTypeCodes?.some((c: string) => c === '30' || c === 'MH' || c === 'A4'),
    )

  const copayRaw = mentalHealth.find((b: any) => b?.code === 'B' && b?.benefitAmount)?.benefitAmount
  const coinsuranceRaw = mentalHealth.find((b: any) => b?.code === 'A' && b?.benefitPercent)?.benefitPercent
  const deductibleTotal = mentalHealth.find((b: any) =>
    b?.code === 'C' &&
    (b?.timeQualifierCode === '29' || (b?.benefitsServiceLine || '').toLowerCase().includes('year')),
  )?.benefitAmount
  const deductibleMet = mentalHealth.find((b: any) =>
    b?.code === 'C' && (b?.inPlanNetworkIndicator === 'Y' || b?.benefitsDateInformation?.spendDown),
  )?.benefitAmount

  const limitation = mentalHealth.find((b: any) => b?.code === 'F' && b?.benefitQuantity)
  const sessionLimit = limitation?.benefitQuantity ? parseInt(limitation.benefitQuantity, 10) : null

  const priorAuthRequired = mentalHealth.some((b: any) =>
    b?.authOrCertIndicator === 'Y' ||
    (b?.eligibilityOrBenefit || '').toLowerCase().includes('prior auth'),
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
    sessionsUsed: null,
    priorAuthRequired,
    planName: activePlan?.planDetails || activePlan?.statusDescription ||
              planStatuses[0]?.planDetails || data?.planInformation?.planDescription || null,
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
  input: EligibilityInput,
  payerId: string | null,
  status: Extract<EligibilityStatus, 'manual_pending' | 'missing_data'>,
  reason: string,
): Promise<EligibilityResult> {
  return persistResult(input, payerId, {
    status, errorMessage: reason, raw: null, parsed: emptyParsed(),
  })
}

async function persistResult(
  input: EligibilityInput,
  payerId: string | null,
  ctx: {
    status: EligibilityStatus
    errorMessage: string | null
    raw: unknown
    parsed: ParsedBenefits
  },
): Promise<EligibilityResult> {
  const { parsed } = ctx
  const nowIso = new Date().toISOString()
  const nextDueIso = new Date(Date.now() + VERIFY_INTERVAL_DAYS * 86_400_000).toISOString()

  let eligibilityCheckId: string | null = null
  try {
    const { rows } = await pool.query(
      `INSERT INTO eligibility_checks (
         insurance_record_id, practice_id, status, is_active,
         mental_health_covered, copay_amount, coinsurance_percent,
         deductible_total, deductible_met, session_limit, sessions_used,
         prior_auth_required, plan_name, coverage_start_date, coverage_end_date,
         payer_id, trigger_source, raw_response, error_message, checked_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7,
         $8, $9, $10, $11,
         $12, $13, $14, $15,
         $16, $17, $18::jsonb, $19, $20
       ) RETURNING id`,
      [
        input.insuranceRecordId, input.practice.id, ctx.status, parsed.isActive,
        parsed.mentalHealthCovered, parsed.copayAmount, parsed.coinsurancePercent,
        parsed.deductibleTotal, parsed.deductibleMet, parsed.sessionLimit, parsed.sessionsUsed,
        parsed.priorAuthRequired, parsed.planName, parsed.coverageStartDate, parsed.coverageEndDate,
        payerId, input.triggerSource, JSON.stringify(ctx.raw ?? null), ctx.errorMessage, nowIso,
      ],
    )
    eligibilityCheckId = rows[0]?.id ?? null
  } catch (err) {
    console.error('[stedi] failed to persist eligibility_checks row', (err as Error).message)
  }

  // Advance parent record cadence even on soft failures.
  try {
    await pool.query(
      `UPDATE insurance_records
          SET last_verified_at = $1,
              last_verification_status = $2,
              next_verify_due = $3,
              updated_at = $1
        WHERE id = $4`,
      [nowIso, ctx.status, nextDueIso, input.insuranceRecordId],
    )
  } catch (err) {
    console.error('[stedi] failed to update insurance_records cadence', (err as Error).message)
  }

  return {
    status: ctx.status,
    insuranceRecordId: input.insuranceRecordId,
    payerId,
    isActive: parsed.isActive,
    mentalHealthCovered: parsed.mentalHealthCovered,
    copayAmount: parsed.copayAmount,
    coinsurancePercent: parsed.coinsurancePercent,
    deductibleTotal: parsed.deductibleTotal,
    deductibleMet: parsed.deductibleMet,
    sessionLimit: parsed.sessionLimit,
    sessionsUsed: parsed.sessionsUsed,
    priorAuthRequired: parsed.priorAuthRequired,
    planName: parsed.planName,
    coverageStartDate: parsed.coverageStartDate,
    coverageEndDate: parsed.coverageEndDate,
    errorMessage: ctx.errorMessage,
    eligibilityCheckId,
  }
}

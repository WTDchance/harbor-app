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
import { logEvent as logStructured } from '@/lib/observability/structured-log'

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
  // Wave 39 — structured error classification for UI mapping.
  // null on success branches; a stable code on error branches.
  errorKind: StediErrorKind | null
  retryable: boolean
}

/**
 * Classification of why a Stedi 270/271 round-trip failed (or returned an
 * empty/inactive payload). Stable string codes that the verify route maps
 * to HTTP statuses and the UI maps to friendly inline copy.
 *
 * - member_not_found  : Stedi could not locate the member with the data we sent.
 *                       Caller fix: re-check member ID, DOB, name spelling.
 * - coverage_inactive : 271 returned successfully but the member's coverage is
 *                       inactive on the date of service. Not a system error;
 *                       the UI shows a coverage-inactive message instead.
 * - payer_down        : Stedi or the downstream payer is unreachable (5xx).
 *                       Retry-after-a-minute is reasonable.
 * - rate_limited      : Stedi returned 429, OR our local per-practice cap fired.
 * - invalid_request   : 400-class — payload shape, NPI, payer ID, etc.
 * - network_error     : fetch threw before getting a response (TCP/TLS).
 * - unknown           : caught nothing else; fall through.
 */
export type StediErrorKind =
  | 'member_not_found'
  | 'coverage_inactive'
  | 'payer_down'
  | 'rate_limited'
  | 'invalid_request'
  | 'network_error'
  | 'unknown'

export interface StediErrorClassification {
  kind: StediErrorKind
  /** User-facing copy. Safe to show inline on the patient profile. */
  message: string
  /** True if a quick retry is reasonable (payer down, transient network, rate limit). */
  retryable: boolean
}

const FRIENDLY_MESSAGES: Record<StediErrorKind, string> = {
  member_not_found:
    "We couldn't find this member with the info on file. Double-check the member ID, date of birth, and name spelling.",
  coverage_inactive:
    'This insurance shows as inactive on the date you searched. The patient may need to verify with their insurer.',
  payer_down:
    'The insurance company is temporarily unreachable. Try again in a few minutes.',
  rate_limited:
    "We've checked this insurance a lot recently. Pause a minute and try again.",
  invalid_request:
    "Insurance card data couldn't be read. Try re-scanning the front and back, or check the member ID and group number for typos.",
  network_error:
    'Connection to the insurance verification service hiccuped. Try again.',
  unknown:
    'Something went wrong checking this insurance. Try again, or contact support if it keeps happening.',
}

const RETRYABLE_KINDS: ReadonlySet<StediErrorKind> = new Set([
  'payer_down', 'rate_limited', 'network_error',
])

/**
 * Map an HTTP status + JSON body from Stedi (or a thrown fetch error) to a
 * stable error kind. Tolerant of payload shape variation across Stedi error
 * envelopes: some return `{ message }`, some return `{ errors: [{code, ...}] }`,
 * some return AAA segment codes embedded in a 271-shaped body.
 */
export function classifyStediError(
  httpStatus: number | null,
  body: any,
  thrownErr?: unknown,
): StediErrorClassification {
  // 1. Network / fetch threw — no httpStatus available.
  if (thrownErr || httpStatus === null) {
    return {
      kind: 'network_error',
      message: FRIENDLY_MESSAGES.network_error,
      retryable: true,
    }
  }

  // 2. Rate limit — Stedi 429 or any body field naming it.
  if (httpStatus === 429 || /rate.?limit/i.test(String(body?.message ?? ''))) {
    return {
      kind: 'rate_limited',
      message: FRIENDLY_MESSAGES.rate_limited,
      retryable: true,
    }
  }

  // 3. 5xx from Stedi — payer or Stedi itself is down.
  if (httpStatus >= 500) {
    return {
      kind: 'payer_down',
      message: FRIENDLY_MESSAGES.payer_down,
      retryable: true,
    }
  }

  // 4. AAA error codes from a 271 envelope (member-not-found family).
  // Stedi flattens AAA segments under `errors` or per-loop `errors` arrays.
  // We accept either shape and probe a small set of well-known codes.
  const errs: any[] = collectStediErrors(body)
  for (const e of errs) {
    const code = String(e?.code ?? e?.errorCode ?? '').toUpperCase()
    const desc = String(
      e?.description ?? e?.message ?? e?.followupAction ?? '',
    ).toLowerCase()
    // 75 / 72 / 73 / T / 79 = subscriber/insured-not-found family.
    if (['75', '72', '73', 'T', '79'].includes(code) ||
        /not\s*found|invalid.*subscriber|invalid.*member/i.test(desc)) {
      return {
        kind: 'member_not_found',
        message: FRIENDLY_MESSAGES.member_not_found,
        retryable: false,
      }
    }
    // 42 = "Unable to Respond at Current Time" — payer-side outage.
    if (code === '42' || /unable to respond|currently unavailable/i.test(desc)) {
      return {
        kind: 'payer_down',
        message: FRIENDLY_MESSAGES.payer_down,
        retryable: true,
      }
    }
  }

  // 5. 4xx fallthrough — request-shape problem.
  if (httpStatus >= 400) {
    return {
      kind: 'invalid_request',
      message: FRIENDLY_MESSAGES.invalid_request,
      retryable: false,
    }
  }

  // 6. Default — preserve the unknown bucket so we see it in logs.
  return {
    kind: 'unknown',
    message: FRIENDLY_MESSAGES.unknown,
    retryable: false,
  }
}

function collectStediErrors(body: any): any[] {
  if (!body || typeof body !== 'object') return []
  const out: any[] = []
  if (Array.isArray(body.errors)) out.push(...body.errors)
  // Per-loop errors (subscriber / dependent / payer envelopes).
  for (const k of ['subscriber', 'dependent', 'payer', 'provider']) {
    const inner = body?.[k]?.errors
    if (Array.isArray(inner)) out.push(...inner)
  }
  return out
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
  let res: Response | undefined
  try {
    res = await fetch(STEDI_ELIGIBILITY_URL, {
      method: 'POST',
      headers: { 'Authorization': `Key ${stediApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    httpOk = res.ok
    stediResponse = await res.json().catch(() => null)
  } catch (err) {
    const classified = classifyStediError(null, null, err)
    logStructured({
      event: 'stedi.eligibility.network_error',
      severity: 'error',
      actor_practice_id: input.practice.id,
      target_id: input.insuranceRecordId,
      target_kind: 'insurance_record',
      ctx: {
        kind: classified.kind,
        retryable: classified.retryable,
        thrown: err instanceof Error ? err.message : String(err),
        payer_id: payerId,
        trigger_source: input.triggerSource,
      },
    })
    return persistResult(input, payerId, {
      status: 'error',
      errorKind: classified.kind,
      retryable: classified.retryable,
      errorMessage: classified.message,
      raw: null, parsed: emptyParsed(),
    })
  }

  if (!httpOk) {
    // Best-effort HTTP status capture — `res` is in this scope only if
    // the fetch resolved, which it did (we set httpOk from it).
    const httpStatus = (typeof res !== 'undefined' && res ? res.status : null)
    const classified = classifyStediError(httpStatus, stediResponse)
    logStructured({
      event: 'stedi.eligibility.http_error',
      severity: 'error',
      status_code: httpStatus ?? undefined,
      actor_practice_id: input.practice.id,
      target_id: input.insuranceRecordId,
      target_kind: 'insurance_record',
      ctx: {
        kind: classified.kind,
        retryable: classified.retryable,
        payer_id: payerId,
        trigger_source: input.triggerSource,
        // Stedi message kept server-side ONLY. Never returned to client.
        stedi_response_summary: summarizeStediResponse(stediResponse),
      },
    })
    return persistResult(input, payerId, {
      status: 'error',
      errorKind: classified.kind,
      retryable: classified.retryable,
      errorMessage: classified.message,
      raw: stediResponse,
      parsed: emptyParsed(),
    })
  }

  const parsed = parseStedi271(stediResponse)
  const status: EligibilityStatus = parsed.isActive ? 'active' : 'inactive'
  // Inactive coverage is a SUCCESSFUL Stedi response with bad news; surface
  // the friendly message but do NOT mark it as a system error. The verify
  // route returns HTTP 200 for this, just with `latest_check.status === 'inactive'`.
  const inactiveMessage =
    status === 'inactive'
      ? FRIENDLY_MESSAGES.coverage_inactive
      : null
  return persistResult(input, payerId, {
    status,
    errorKind: status === 'inactive' ? 'coverage_inactive' : null,
    retryable: false,
    errorMessage: inactiveMessage,
    raw: stediResponse,
    parsed,
  })
}

// Keep ONLY high-level shape info from the Stedi body for structured logs.
// We never want member IDs, names, or DOBs in CloudWatch via this path.
function summarizeStediResponse(body: any): Record<string, unknown> {
  if (!body || typeof body !== 'object') return { shape: typeof body }
  return {
    has_errors: Array.isArray(body?.errors) ? body.errors.length : 0,
    has_benefitsInformation: Array.isArray(body?.benefitsInformation),
    transactionStatus: body?.transactionStatus ?? null,
    error_codes: collectStediErrors(body)
      .map((e: any) => String(e?.code ?? e?.errorCode ?? ''))
      .filter(Boolean)
      .slice(0, 10),
  }
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
    status,
    // Short-circuit reasons (no API key, unknown payer, missing member ID) are
    // request-shape problems from our side — invalid_request is the closest
    // bucket. Caller fix is to update the practice config or the patient row.
    errorKind: 'invalid_request',
    retryable: false,
    errorMessage: reason,
    raw: null,
    parsed: emptyParsed(),
  })
}

async function persistResult(
  input: EligibilityInput,
  payerId: string | null,
  ctx: {
    status: EligibilityStatus
    errorKind: StediErrorKind | null
    retryable: boolean
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
    errorKind: ctx.errorKind,
    retryable: ctx.retryable,
  }
}

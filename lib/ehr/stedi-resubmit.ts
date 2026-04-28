// lib/ehr/stedi-resubmit.ts
//
// Wave 41 / T5 patch — shared "rebuild a 837 from a prior submission
// and submit again" helper. Backs both the resubmit-claim and
// cancel-claim endpoints; the two only differ in (a) the ClaimFrequency
// Code we emit and (b) the audit action emitted on success.
//
// The CFC/PCN/PCCN computation matrix below is the heart of this file
// and the reason we need a helper at all. From Stedi's docs:
//
//   ┌──────────────────────────────┬───────┬──────────────────┬──────────────┐
//   │ scenario                     │ CFC   │ PCN              │ PCCN         │
//   ├──────────────────────────────┼───────┼──────────────────┼──────────────┤
//   │ pre-adj, professional/dental │ 1     │ same as original │ omit         │
//   │ adj, Medicare, pro/dental    │ 1     │ same as original │ omit         │
//   │ adj, non-Medicare, replace   │ 7     │ NEW unique PCN   │ include      │
//   │ adj, non-Medicare, cancel    │ 8     │ NEW unique PCN   │ include      │
//   └──────────────────────────────┴───────┴──────────────────┴──────────────┘
//
// Pre-adj vs adj is detected from `is_in_adjudication` (set TRUE when
// the 277CA assigned a PCCN). Medicare vs non-Medicare is the
// `stedi_payers.is_medicare` flag.

import { pool } from '@/lib/aws/db'
import { generatePcn, validateStediBodyChars } from '@/lib/ehr/stedi-pcn'
import { isMedicarePayer } from '@/lib/ehr/stedi-medicare'

const STEDI_837_URL =
  'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/professionalclaims/v3/submission'

function newControlNumber(): string {
  const seed =
    Date.now().toString().slice(-6) +
    Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return seed.slice(0, 9)
}

export type ResubmitMode = 'replace' | 'cancel'

export type ResubmitParams = {
  practiceId: string
  invoiceId: string
  submittedByUserId: string
  mode: ResubmitMode
  /** Optional invoice-level corrections — the resubmit UI sends these. */
  corrections?: Record<string, unknown>
  /** Free-text clinician note explaining why we resubmitted/cancelled. */
  reason?: string
}

export type ResubmitOutcome =
  | {
      ok: true
      submission: any
      cfc: '1' | '7' | '8'
      pcn: string
      pccn: string | null
      isMedicare: boolean
      isInAdjudication: boolean
    }
  | {
      ok: false
      status: number
      error: string
      issues?: unknown
    }

export async function resubmitOrCancelClaim(p: ResubmitParams): Promise<ResubmitOutcome> {
  // 1. Find the most recent submission for this invoice. We need its
  //    request_payload_json (so we can re-build the 837 from the same
  //    base shape) AND its lifecycle flags (is_in_adjudication, pcn,
  //    PCCN).
  const subRes = await pool.query(
    `SELECT s.*
       FROM ehr_claim_submissions s
      WHERE s.practice_id = $1 AND s.invoice_id = $2
      ORDER BY s.submitted_at DESC
      LIMIT 1`,
    [p.practiceId, p.invoiceId],
  )
  if (subRes.rows.length === 0) {
    return { ok: false, status: 404, error: 'No prior submission found for this invoice.' }
  }
  const prior = subRes.rows[0]

  // 2. Determine pre-adj vs adj, Medicare vs non-Medicare.
  const isInAdjudication: boolean = prior.is_in_adjudication === true
  const isMedicare = await isMedicarePayer(prior.payer_id_837)

  // 3. Compute CFC + PCN + PCCN per the matrix.
  let cfc: '1' | '7' | '8'
  let pcn: string
  let pccn: string | null

  if (p.mode === 'cancel') {
    // CFC=8 cancellations are only valid in adjudication and only for
    // non-Medicare payers (Medicare won't accept CFC=7 or 8 on
    // professional/dental — must use CFC=1).
    if (!isInAdjudication) {
      return {
        ok: false,
        status: 422,
        error: 'Cancellation requires the claim to be in adjudication (a 277CA must have assigned a PCCN).',
      }
    }
    if (isMedicare) {
      return {
        ok: false,
        status: 422,
        error: 'Medicare does not accept CFC=8 cancellations. Submit a corrected claim with CFC=1 instead.',
      }
    }
    cfc = '8'
    pcn = generatePcn() // NEW PCN for non-Medicare adjudication
    pccn = prior.payer_claim_control_number ?? null
    if (!pccn) {
      // Defensive — shouldn't happen if is_in_adjudication is true.
      return {
        ok: false,
        status: 422,
        error: 'Cannot cancel — no payer claim control number on file.',
      }
    }
  } else {
    // Replacement / corrected resubmission.
    if (!isInAdjudication) {
      // Pre-adjudication. Same PCN, no PCCN, CFC=1 (pro/dental
      // assumption; Harbor only submits professional 837 today).
      cfc = '1'
      pcn = prior.pcn
      pccn = null
    } else if (isMedicare) {
      // Medicare adjudication. CFC=1, reuse PCN, NO PCCN.
      cfc = '1'
      pcn = prior.pcn
      pccn = null
    } else {
      // Non-Medicare adjudication. CFC=7 (Replacement), NEW PCN,
      // include PCCN.
      cfc = '7'
      pcn = generatePcn()
      pccn = prior.payer_claim_control_number ?? null
      if (!pccn) {
        return {
          ok: false,
          status: 422,
          error: 'Cannot resubmit corrected non-Medicare claim — no payer claim control number on file.',
        }
      }
    }
  }

  // 4. Rebuild the 837 payload from the prior request_payload_json,
  //    overriding the lifecycle fields and applying any caller
  //    corrections.
  const basePayload: any =
    typeof prior.request_payload_json === 'string'
      ? JSON.parse(prior.request_payload_json)
      : prior.request_payload_json ?? {}

  const controlNumber = newControlNumber()
  const claimInfo = { ...(basePayload.claimInformation ?? {}) }
  claimInfo.patientControlNumber = pcn
  claimInfo.claimFrequencyCode = cfc

  // PCCN goes under claimSupplementalInformation per Stedi docs.
  if (pccn) {
    claimInfo.claimSupplementalInformation = {
      ...(claimInfo.claimSupplementalInformation ?? {}),
      claimControlNumber: pccn,
    }
  } else if (claimInfo.claimSupplementalInformation?.claimControlNumber) {
    // Stedi requires PCCN to be omitted on pre-adj and Medicare;
    // strip if it leaked from the prior payload.
    const supp = { ...claimInfo.claimSupplementalInformation }
    delete supp.claimControlNumber
    if (Object.keys(supp).length === 0) {
      delete claimInfo.claimSupplementalInformation
    } else {
      claimInfo.claimSupplementalInformation = supp
    }
  }

  // Corrections — shallow merge into claimInformation. The resubmit UI
  // typically passes diagnosis-code / charge-line tweaks here.
  if (p.corrections && typeof p.corrections === 'object') {
    Object.assign(claimInfo, p.corrections)
  }

  const payload = {
    ...basePayload,
    controlNumber,
    claimInformation: claimInfo,
  }

  // 5. Reserved-delimiter validation.
  const issues = validateStediBodyChars(payload)
  if (issues.length > 0) {
    return {
      ok: false,
      status: 422,
      error: 'X12 reserved delimiter found in claim body. Strip ~ * : ^ from the offending field(s) and retry.',
      issues: issues.map((i) => ({ field: i.path, char: i.char, snippet: i.snippet })),
    }
  }

  // 6. Submit.
  let httpStatus = 0
  let stediResponse: any = null
  let isAccepted = false
  try {
    const res = await fetch(STEDI_837_URL, {
      method: 'POST',
      headers: {
        Authorization: `Key ${process.env.STEDI_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    httpStatus = res.status
    stediResponse = await res.json().catch(() => null)
    isAccepted = res.ok
  } catch (err) {
    stediResponse = { error: (err as Error).message }
  }

  const submissionStatus = httpStatus === 0 ? 'error' : isAccepted ? 'accepted' : 'rejected'
  const stediSubmissionId =
    typeof stediResponse?.controlNumber === 'string'
      ? stediResponse.controlNumber
      : typeof stediResponse?.id === 'string'
      ? stediResponse.id
      : null
  const rejectionReason = !isAccepted
    ? stediResponse?.message || stediResponse?.error || (httpStatus ? `HTTP ${httpStatus}` : 'network error')
    : null

  // 7. Persist new submission row, linked to the original via
  //    original_submission_id (preserve the lineage even after a chain
  //    of replacements).
  const originalId: string =
    prior.original_submission_id ?? prior.id

  const ins = await pool.query(
    `INSERT INTO ehr_claim_submissions
       (practice_id, invoice_id, submitted_by_user_id,
        payer_id_837, payer_name, control_number, pcn,
        request_payload_json, response_payload_json,
        stedi_submission_id, http_status, is_accepted, rejection_reason, status,
        original_submission_id, is_cancellation,
        payer_claim_control_number, is_in_adjudication)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             $8::jsonb, $9::jsonb,
             $10, $11, $12, $13, $14,
             $15, $16,
             $17, $18)
     RETURNING *`,
    [
      p.practiceId, p.invoiceId, p.submittedByUserId,
      prior.payer_id_837, prior.payer_name, controlNumber, pcn,
      JSON.stringify(payload), JSON.stringify(stediResponse ?? {}),
      stediSubmissionId, httpStatus, isAccepted, rejectionReason, submissionStatus,
      originalId, p.mode === 'cancel',
      pccn, isInAdjudication,
    ],
  )

  // 8. Mirror onto the parent invoice. Cancellation flips the invoice
  //    submission_status to 'denied' (close enough — we don't have a
  //    'cancelled' bucket and 'denied' is the closest semantically;
  //    the audit action distinguishes).
  if (p.mode === 'cancel' && isAccepted) {
    await pool
      .query(
        `UPDATE ehr_invoices SET submission_status = 'denied', updated_at = NOW()
          WHERE id = $1 AND practice_id = $2`,
        [p.invoiceId, p.practiceId],
      )
      .catch(() => {})
  } else if (isAccepted) {
    await pool
      .query(
        `UPDATE ehr_invoices SET submission_status = $1, stedi_submission_id = $2, updated_at = NOW()
          WHERE id = $3 AND practice_id = $4 AND submission_status NOT IN ('paid')`,
        [submissionStatus, stediSubmissionId, p.invoiceId, p.practiceId],
      )
      .catch(() => {})
  }

  return {
    ok: true,
    submission: ins.rows[0],
    cfc,
    pcn,
    pccn,
    isMedicare,
    isInAdjudication,
  }
}

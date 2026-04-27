// app/api/ehr/billing/invoices/[id]/submit-claim/route.ts
//
// Wave 41 / T5 — submit an invoice as an 837 professional claim
// via Stedi.
//
// Pre-flight validation runs first (validateClaimContext) and
// returns the issue list with HTTP 422 if any required field is
// missing — this catches problems BEFORE we burn a control
// number / Stedi API call.
//
// On Stedi success: insert ehr_claim_submissions row + flip
// ehr_invoices.submission_status to 'accepted'/'rejected' based
// on the response. control_number = ehr_invoices.id (so the 835
// auto-match in T4 finds this invoice via claim_reference).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { resolvePayerIdWithDb } from '@/lib/aws/stedi/payers'
import { findActiveAuth } from '@/lib/aws/ehr/authorizations'
import {
  validateClaimContext,
  type ClaimSubmitContext,
} from '@/lib/aws/stedi/claim-submit-validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STEDI_837_URL =
  'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/professionalclaims/v3/submission'

function newControlNumber(): string {
  const seed = Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return seed.slice(0, 9)
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: invoiceId } = await params

  // Load invoice + charges + patient + practice in parallel.
  const [invRes, prRes] = await Promise.all([
    pool.query(
      `SELECT i.*, p.first_name, p.last_name, p.date_of_birth,
              p.insurance_provider, p.insurance_member_id
         FROM ehr_invoices i
         JOIN patients p ON p.id = i.patient_id
        WHERE i.practice_id = $1 AND i.id = $2 LIMIT 1`,
      [ctx.practiceId, invoiceId],
    ),
    pool.query(
      `SELECT id, name, npi, billing_tax_id FROM practices WHERE id = $1 LIMIT 1`,
      [ctx.practiceId],
    ),
  ])
  const invoice = invRes.rows[0]
  const practice = prRes.rows[0]
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (!practice) return NextResponse.json({ error: 'Practice not found' }, { status: 404 })

  // Charges + ICD-10 join.
  const chargeIds: string[] = invoice.charge_ids ?? []
  const chRes = chargeIds.length > 0
    ? await pool.query(
        `SELECT c.id, c.cpt_code, c.units, c.fee_cents, c.service_date, c.note_id,
                COALESCE(n.icd10_codes, ARRAY[]::TEXT[]) AS icd10_codes
           FROM ehr_charges c
           LEFT JOIN ehr_progress_notes n ON n.id = c.note_id
          WHERE c.id = ANY($1::uuid[]) AND c.practice_id = $2`,
        [chargeIds, ctx.practiceId],
      )
    : { rows: [] as any[] }

  // Resolve payer_id_837 (cached on invoice if previously submitted).
  let payerId837: string | null = invoice.payer_id_837 ?? null
  if (!payerId837 && invoice.insurance_provider) {
    payerId837 = await resolvePayerIdWithDb(invoice.insurance_provider, null)
  }

  // Look up an active authorization for the first CPT (best-effort —
  // a richer flow would check per-charge).
  const firstCpt = chRes.rows[0]?.cpt_code ?? null
  const auth = firstCpt
    ? await findActiveAuth({
        practiceId: ctx.practiceId!,
        patientId: invoice.patient_id,
        cptCode: firstCpt,
        scheduledFor: chRes.rows[0]?.service_date ?? new Date().toISOString(),
      })
    : null

  const validationCtx: ClaimSubmitContext = {
    practice: {
      id: practice.id,
      name: practice.name ?? null,
      npi: practice.npi ?? null,
      billing_tax_id: practice.billing_tax_id ?? null,
    },
    patient: {
      id: invoice.patient_id,
      first_name: invoice.first_name ?? null,
      last_name: invoice.last_name ?? null,
      date_of_birth: invoice.date_of_birth ?? null,
      insurance_provider: invoice.insurance_provider ?? null,
      insurance_member_id: invoice.insurance_member_id ?? null,
    },
    invoice: {
      id: invoice.id,
      total_cents: Number(invoice.total_cents),
      charge_ids: chargeIds,
    },
    charges: chRes.rows.map((r: any) => ({
      id: r.id,
      cpt_code: r.cpt_code ?? null,
      icd10_codes: r.icd10_codes ?? [],
      units: Number(r.units ?? 1),
      fee_cents: Number(r.fee_cents ?? 0),
      service_date: r.service_date ? String(r.service_date).slice(0, 10) : null,
    })),
    authorization: auth ? {
      auth_number: auth.auth_number,
      valid_from: auth.valid_from,
      valid_to: auth.valid_to,
    } : undefined,
    payer_id_837: payerId837,
  }

  const issues = validateClaimContext(validationCtx)
  if (issues.length > 0) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Claim is missing required fields. Fix the issues below and retry.',
        },
        issues,
      },
      { status: 422 },
    )
  }

  // Build a Stedi 837 payload. Minimal valid shape — Stedi fills in
  // most envelope details. Use invoice.id as the control_number /
  // patientControlNumber so the 835 auto-match in T4 can find this
  // invoice via claim_reference.
  const controlNumber = newControlNumber()
  const payload = {
    controlNumber,
    tradingPartnerServiceId: payerId837,
    submitter: {
      organizationName: validationCtx.practice.name,
      contactInformation: {
        name: validationCtx.practice.name,
      },
    },
    receiver: { organizationName: 'Payer' },
    billing: {
      organizationName: validationCtx.practice.name,
      taxId: validationCtx.practice.billing_tax_id,
      npi: validationCtx.practice.npi,
    },
    subscriber: {
      memberId: validationCtx.patient.insurance_member_id,
      paymentResponsibilityLevelCode: 'P',
      firstName: validationCtx.patient.first_name,
      lastName: validationCtx.patient.last_name,
      dateOfBirth: (validationCtx.patient.date_of_birth ?? '').replace(/-/g, ''),
    },
    claimInformation: {
      claimFilingCode: 'CI',
      patientControlNumber: invoice.id, // <- T4 auto-matches against ehr_invoices.id
      claimChargeAmount: (validationCtx.invoice.total_cents / 100).toFixed(2),
      placeOfServiceCode: '11',
      claimFrequencyCode: '1',
      principalDiagnosis: { qualifierCode: 'ABK', principalDiagnosisCode: validationCtx.charges[0]?.icd10_codes?.[0] ?? null },
      serviceLines: validationCtx.charges.map((c) => ({
        serviceDate: (c.service_date ?? '').replace(/-/g, ''),
        professionalService: {
          procedureIdentifier: 'HC',
          procedureCode: c.cpt_code,
          lineItemChargeAmount: (c.fee_cents / 100).toFixed(2),
          measurementUnit: 'UN',
          serviceUnitCount: String(c.units),
          compositeDiagnosisCodePointers: { diagnosisCodePointers: ['1'] },
        },
      })),
    },
    priorAuthorizationNumber: validationCtx.authorization?.auth_number ?? undefined,
  }

  // Submit to Stedi.
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

  // Insert submission row.
  const submissionStatus = httpStatus === 0
    ? 'error'
    : isAccepted ? 'accepted' : 'rejected'
  const stediSubmissionId =
    typeof stediResponse?.controlNumber === 'string' ? stediResponse.controlNumber :
    typeof stediResponse?.id === 'string' ? stediResponse.id :
    null
  const rejectionReason = !isAccepted
    ? (stediResponse?.message || stediResponse?.error || `HTTP ${httpStatus}`)
    : null

  const { rows } = await pool.query(
    `INSERT INTO ehr_claim_submissions
       (practice_id, invoice_id, submitted_by_user_id,
        payer_id_837, payer_name, control_number,
        request_payload_json, response_payload_json,
        stedi_submission_id, http_status, is_accepted, rejection_reason, status)
     VALUES ($1, $2, $3, $4, $5, $6,
             $7::jsonb, $8::jsonb,
             $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      ctx.practiceId, invoice.id, ctx.user.id,
      payerId837, invoice.insurance_provider, controlNumber,
      JSON.stringify(payload), JSON.stringify(stediResponse ?? {}),
      stediSubmissionId, httpStatus, isAccepted, rejectionReason, submissionStatus,
    ],
  )

  // Update parent invoice + audit.
  await pool.query(
    `UPDATE ehr_invoices
        SET submitted_at        = NOW(),
            stedi_submission_id = $1,
            submission_status   = $2,
            payer_id_837        = $3,
            updated_at          = NOW()
      WHERE id = $4`,
    [stediSubmissionId, submissionStatus, payerId837, invoice.id],
  )

  await auditEhrAccess({
    ctx,
    action: isAccepted ? 'claim.accepted' : (httpStatus === 0 ? 'claim.submitted' : 'claim.rejected'),
    resourceType: 'ehr_claim_submission',
    resourceId: rows[0].id,
    details: {
      invoice_id: invoice.id,
      payer_id_837: payerId837,
      control_number: controlNumber,
      http_status: httpStatus,
      is_accepted: isAccepted,
    },
  })
  // Always also fire claim.submitted so the trail captures every attempt
  // (accepted/rejected fired above are end-state only).
  if (isAccepted || httpStatus !== 0) {
    await auditEhrAccess({
      ctx,
      action: 'claim.submitted',
      resourceType: 'ehr_claim_submission',
      resourceId: rows[0].id,
      details: { invoice_id: invoice.id, control_number: controlNumber },
    })
  }

  return NextResponse.json({
    submission: rows[0],
    issues: [],
    accepted: isAccepted,
    rejection_reason: rejectionReason,
  })
}

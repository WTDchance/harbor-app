// app/api/ehr/patients/[id]/preauth-requests/[reqId]/submit/route.ts
//
// Wave 43 — finalise a draft pre-auth request and stream the packet PDF
// back to the therapist. The therapist takes the bytes and faxes / uploads /
// emails / mails the packet themselves. We just record method + reference.
//
// Mutation:
//   status         draft  -> submitted
//   submitted_at   NULL   -> NOW()
//   submission_method, submission_reference   from request body
//
// Response: application/pdf stream (the packet). The route also writes a
// preauth.submit audit row.
//
// Optional Stedi 278 — body.submission_method='stedi_278' is accepted
// (stretch goal in W43 brief). The PDF is still generated as a paper trail
// even when 278 succeeds; actual 278 submission is a follow-up wave (no
// Stedi SDK call from here for now — see notes in the W43 final report).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { renderPreauthPacketPdf, type PreauthCptLine, type PreauthDxLine } from '@/lib/ehr/preauth-packet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_METHODS = ['fax', 'portal', 'email', 'mail', 'stedi_278'] as const

type RouteCtx = { params: Promise<{ id: string; reqId: string }> | { id: string; reqId: string } }
async function resolveParams(p: RouteCtx['params']): Promise<{ id: string; reqId: string }> {
  return (p && typeof (p as Promise<unknown>).then === 'function')
    ? await (p as Promise<{ id: string; reqId: string }>)
    : (p as { id: string; reqId: string })
}

export async function POST(req: NextRequest, route: RouteCtx) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, reqId } = await resolveParams(route.params)

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const method = typeof body.submission_method === 'string' ? body.submission_method : ''
  if (!(VALID_METHODS as readonly string[]).includes(method)) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: `submission_method must be one of: ${VALID_METHODS.join(', ')}` } },
      { status: 400 },
    )
  }
  const reference = typeof body.submission_reference === 'string' ? body.submission_reference.trim() || null : null

  // Fetch the request, the patient, the practice, and the requesting user's
  // therapist record (for NPI / license). One round-trip via Promise.all.
  const [reqRes, patientRes, practiceRes, therapistRes] = await Promise.all([
    pool.query(
      `SELECT *,
              requested_start_date::text AS requested_start_date,
              requested_end_date::text   AS requested_end_date
         FROM ehr_preauth_requests
        WHERE id = $1 AND practice_id = $2 AND patient_id = $3`,
      [reqId, ctx.practiceId, patientId],
    ),
    pool.query(
      `SELECT id, first_name, last_name, date_of_birth, insurance_group_id
         FROM patients WHERE id = $1 AND practice_id = $2`,
      [patientId, ctx.practiceId],
    ),
    pool.query(
      `SELECT name, billing_npi, billing_tax_id, phone, owner_email AS email,
              city, state
         FROM practices WHERE id = $1`,
      [ctx.practiceId],
    ),
    pool.query(
      `SELECT full_name, npi, license_number, license_type, license_state
         FROM therapists
        WHERE practice_id = $1 AND user_id = $2
        LIMIT 1`,
      [ctx.practiceId, ctx.user.id],
    ).catch(() => ({ rows: [] as any[] })),
  ])

  if (reqRes.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const reqRow = reqRes.rows[0]
  if (reqRow.status !== 'draft') {
    return NextResponse.json(
      {
        error: {
          code: 'not_draft',
          message: `Request is in status='${reqRow.status}' — only drafts can be submitted.`,
        },
      },
      { status: 409 },
    )
  }
  if (patientRes.rows.length === 0) return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  const patient = patientRes.rows[0]
  const practice = practiceRes.rows[0] ?? {}
  const therapist = therapistRes.rows[0] ?? {}

  // Build PDF input. CPT/DX descriptions left null — therapist-entered
  // codes are authoritative; description lookup is a separate concern.
  const cpts: PreauthCptLine[] = (reqRow.cpt_codes || []).map((c: string) => ({ code: c }))
  const dxs: PreauthDxLine[] = (reqRow.diagnosis_codes || []).map((c: string) => ({ code: c }))

  const bytes = await renderPreauthPacketPdf({
    practice: {
      name: practice.name ?? 'Therapy Practice',
      address_line1: null,
      address_line2: null,
      city: practice.city ?? null,
      state: practice.state ?? null,
      zip: null,
      phone: practice.phone ?? null,
      email: practice.email ?? null,
      npi: practice.billing_npi ?? null,
      tax_id: practice.billing_tax_id ?? null,
    },
    provider: {
      name: therapist.full_name ?? ctx.session.email ?? null,
      npi: therapist.npi ?? null,
      license_number: therapist.license_number ?? null,
      license_type: therapist.license_type ?? null,
      license_state: therapist.license_state ?? null,
    },
    patient: {
      first_name: patient.first_name ?? null,
      last_name: patient.last_name ?? null,
      dob: patient.date_of_birth ?? null,
      member_id: reqRow.member_id,
      group_id: patient.insurance_group_id ?? null,
      policy_holder_name: null,
      payer_name: reqRow.payer_name,
    },
    diagnoses: dxs,
    cpts,
    requested_session_count: Number(reqRow.requested_session_count),
    requested_start_date: reqRow.requested_start_date,
    requested_end_date: reqRow.requested_end_date,
    frequency_label: null,
    clinical_justification: reqRow.clinical_justification,
    generated_at: new Date().toISOString(),
    request_id: reqRow.id,
  })

  // Flip the row to submitted. We do this AFTER PDF render so a render
  // failure leaves the draft editable.
  await pool.query(
    `UPDATE ehr_preauth_requests
        SET status = 'submitted',
            submitted_at = NOW(),
            submission_method = $1,
            submission_reference = $2
      WHERE id = $3`,
    [method, reference, reqId],
  )

  await auditEhrAccess({
    ctx,
    action: 'preauth.submit',
    resourceType: 'ehr_preauth_request',
    resourceId: reqId,
    details: {
      patient_id: patientId,
      submission_method: method,
      submission_reference: reference,
      pdf_size_bytes: bytes.length,
      stedi_278_attempted: method === 'stedi_278',
    },
  })

  const filename = `preauth-${(patient.last_name || 'patient').toString().replace(/\s+/g, '_')}-${reqRow.payer_name.replace(/\s+/g, '_')}-${new Date().toISOString().slice(0, 10)}.pdf`
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

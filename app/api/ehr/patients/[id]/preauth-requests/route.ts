// app/api/ehr/patients/[id]/preauth-requests/route.ts
//
// Wave 43 / W43-PRE — list + create pre-authorization REQUESTS.
// Counterpart to W40's /api/ehr/insurance-authorizations (which holds rows
// the payer has already approved).
//
// GET   list pre-auth requests for the patient (most-recent first).
// POST  create a draft. status defaults to 'draft' so the therapist can
//       still edit before calling /submit.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteCtx = { params: Promise<{ id: string }> | { id: string } }

async function resolveParams(p: RouteCtx['params']): Promise<{ id: string }> {
  return (p && typeof (p as Promise<unknown>).then === 'function')
    ? await (p as Promise<{ id: string }>)
    : (p as { id: string })
}

function asArray(x: unknown): string[] {
  if (!Array.isArray(x)) return []
  return x.map(v => String(v).trim()).filter(Boolean)
}

export async function GET(_req: NextRequest, route: RouteCtx) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await resolveParams(route.params)

  const { rows } = await pool.query(
    `SELECT *,
            requested_start_date::text AS requested_start_date,
            requested_end_date::text   AS requested_end_date
       FROM ehr_preauth_requests
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY created_at DESC
      LIMIT 200`,
    [ctx.practiceId, patientId],
  )

  await auditEhrAccess({
    ctx,
    action: 'preauth.list',
    resourceType: 'ehr_preauth_request_list',
    resourceId: patientId,
    details: { count: rows.length },
  })

  return NextResponse.json({ preauth_requests: rows })
}

export async function POST(req: NextRequest, route: RouteCtx) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await resolveParams(route.params)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const payerName = typeof body.payer_name === 'string' ? body.payer_name.trim() : ''
  const payerPayerId = typeof body.payer_payer_id === 'string' ? body.payer_payer_id.trim() || null : null
  const memberId = typeof body.member_id === 'string' ? body.member_id.trim() : ''
  const cptCodes = asArray(body.cpt_codes)
  const dxCodes = asArray(body.diagnosis_codes)
  const sessionCount = Number(body.requested_session_count)
  const startDate = typeof body.requested_start_date === 'string' ? body.requested_start_date : ''
  const endDate = typeof body.requested_end_date === 'string' && body.requested_end_date ? body.requested_end_date : null
  const justification = typeof body.clinical_justification === 'string' ? body.clinical_justification.trim() : ''

  if (!payerName || !memberId || cptCodes.length === 0 || dxCodes.length === 0
    || !Number.isFinite(sessionCount) || sessionCount <= 0
    || !startDate || !justification) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message: 'payer_name, member_id, at least one CPT + diagnosis code, requested_session_count > 0, requested_start_date, and clinical_justification are required.',
        },
      },
      { status: 400 },
    )
  }

  const { rows } = await pool.query(
    `INSERT INTO ehr_preauth_requests
       (patient_id, practice_id, requested_by_user_id,
        payer_name, payer_payer_id, member_id,
        cpt_codes, diagnosis_codes,
        requested_session_count, requested_start_date, requested_end_date,
        clinical_justification, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12, 'draft')
     RETURNING *,
       requested_start_date::text AS requested_start_date,
       requested_end_date::text   AS requested_end_date`,
    [
      patientId, ctx.practiceId, ctx.user.id,
      payerName, payerPayerId, memberId,
      cptCodes, dxCodes,
      sessionCount, startDate, endDate,
      justification,
    ],
  )

  await auditEhrAccess({
    ctx,
    action: 'preauth.create',
    resourceType: 'ehr_preauth_request',
    resourceId: rows[0].id,
    details: {
      patient_id: patientId,
      payer_name: payerName,
      cpt_codes_count: cptCodes.length,
      diagnosis_codes_count: dxCodes.length,
      requested_session_count: sessionCount,
    },
  })

  return NextResponse.json({ preauth_request: rows[0] }, { status: 201 })
}

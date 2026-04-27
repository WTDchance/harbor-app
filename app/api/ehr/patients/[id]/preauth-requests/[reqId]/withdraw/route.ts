// app/api/ehr/patients/[id]/preauth-requests/[reqId]/withdraw/route.ts
//
// Wave 43 — therapist withdraws a pre-auth request before the payer rules.
// Allowed from draft/submitted/pending. Closed states (approved/denied/
// expired/withdrawn) are not re-openable here.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  const reason = typeof body.reason === 'string' ? body.reason.trim() : null

  const cur = await pool.query(
    `SELECT id, status FROM ehr_preauth_requests
      WHERE id = $1 AND practice_id = $2 AND patient_id = $3`,
    [reqId, ctx.practiceId, patientId],
  )
  if (cur.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!['draft', 'submitted', 'pending'].includes(cur.rows[0].status)) {
    return NextResponse.json(
      {
        error: {
          code: 'wrong_status',
          message: `Cannot withdraw a request in status='${cur.rows[0].status}'.`,
        },
      },
      { status: 409 },
    )
  }

  const upd = await pool.query(
    `UPDATE ehr_preauth_requests
        SET status = 'withdrawn',
            payer_response_summary = COALESCE($1, payer_response_summary)
      WHERE id = $2
      RETURNING *,
        requested_start_date::text AS requested_start_date,
        requested_end_date::text   AS requested_end_date`,
    [reason, reqId],
  )

  await auditEhrAccess({
    ctx,
    action: 'preauth.withdraw',
    resourceType: 'ehr_preauth_request',
    resourceId: reqId,
    details: { patient_id: patientId, reason },
  })

  return NextResponse.json({ preauth_request: upd.rows[0] })
}

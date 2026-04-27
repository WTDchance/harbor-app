// app/api/ehr/patients/[id]/preauth-requests/[reqId]/route.ts
//
// Wave 43 — read-one + edit-while-draft endpoints for a pre-auth request.
//
// GET    fetch a single request (any status — used by the detail page).
// PATCH  edit fields. Only allowed while status='draft'; once the packet has
//        gone out (submitted/pending/approved/...) the row is closed.

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

function asArray(x: unknown): string[] | null {
  if (x === undefined) return null
  if (!Array.isArray(x)) return null
  return x.map(v => String(v).trim()).filter(Boolean)
}

export async function GET(_req: NextRequest, route: RouteCtx) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, reqId } = await resolveParams(route.params)

  const { rows } = await pool.query(
    `SELECT *,
            requested_start_date::text AS requested_start_date,
            requested_end_date::text   AS requested_end_date
       FROM ehr_preauth_requests
      WHERE id = $1 AND practice_id = $2 AND patient_id = $3
      LIMIT 1`,
    [reqId, ctx.practiceId, patientId],
  )
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'preauth.view',
    resourceType: 'ehr_preauth_request',
    resourceId: reqId,
    details: { patient_id: patientId },
  })

  return NextResponse.json({ preauth_request: rows[0] })
}

export async function PATCH(req: NextRequest, route: RouteCtx) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, reqId } = await resolveParams(route.params)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  // Confirm the row is still a draft before we mutate.
  const cur = await pool.query(
    `SELECT id, status FROM ehr_preauth_requests
      WHERE id = $1 AND practice_id = $2 AND patient_id = $3`,
    [reqId, ctx.practiceId, patientId],
  )
  if (cur.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (cur.rows[0].status !== 'draft') {
    return NextResponse.json(
      {
        error: {
          code: 'not_editable',
          message: `Pre-auth request is in status='${cur.rows[0].status}' and can no longer be edited. Withdraw and re-create if changes are needed.`,
        },
      },
      { status: 409 },
    )
  }

  // Build a dynamic UPDATE — only the fields the caller passed.
  const sets: string[] = []
  const args: unknown[] = []
  function addSet(col: string, val: unknown, cast?: string) {
    args.push(val)
    sets.push(`${col} = $${args.length}${cast ? `::${cast}` : ''}`)
  }

  if (typeof body.payer_name === 'string') addSet('payer_name', body.payer_name.trim())
  if (typeof body.payer_payer_id === 'string') addSet('payer_payer_id', body.payer_payer_id.trim() || null)
  if (typeof body.member_id === 'string') addSet('member_id', body.member_id.trim())
  const cpt = asArray(body.cpt_codes)
  if (cpt) addSet('cpt_codes', cpt)
  const dx = asArray(body.diagnosis_codes)
  if (dx) addSet('diagnosis_codes', dx)
  if (Number.isFinite(Number(body.requested_session_count))) {
    const n = Number(body.requested_session_count)
    if (n <= 0) return NextResponse.json({ error: 'requested_session_count must be > 0' }, { status: 400 })
    addSet('requested_session_count', n)
  }
  if (typeof body.requested_start_date === 'string' && body.requested_start_date) {
    addSet('requested_start_date', body.requested_start_date, 'date')
  }
  if ('requested_end_date' in body) {
    const v = typeof body.requested_end_date === 'string' && body.requested_end_date ? body.requested_end_date : null
    addSet('requested_end_date', v, 'date')
  }
  if (typeof body.clinical_justification === 'string') addSet('clinical_justification', body.clinical_justification.trim())

  if (sets.length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  args.push(reqId)
  const { rows } = await pool.query(
    `UPDATE ehr_preauth_requests
        SET ${sets.join(', ')}
      WHERE id = $${args.length}
      RETURNING *,
        requested_start_date::text AS requested_start_date,
        requested_end_date::text   AS requested_end_date`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'preauth.update',
    resourceType: 'ehr_preauth_request',
    resourceId: reqId,
    details: { patient_id: patientId, fields_updated: sets.length },
  })

  return NextResponse.json({ preauth_request: rows[0] })
}

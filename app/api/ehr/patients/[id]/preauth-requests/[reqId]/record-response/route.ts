// app/api/ehr/patients/[id]/preauth-requests/[reqId]/record-response/route.ts
//
// Wave 43 — therapist records the payer's response on a submitted request.
//
// Body:
//   { decision: 'pending'|'approved'|'denied'|'expired',
//     summary: string,                           // free-text payer response notes
//     // approved-only:
//     auth_number: string,
//     sessions_authorized: number,
//     valid_from?: ISO date,
//     valid_to?: ISO date,
//     cpt_codes_covered?: string[]               // defaults to request's cpt_codes
//   }
//
// On 'approved' we INSERT a row into ehr_insurance_authorizations (the W40
// schema) and store its id back on the request via resulting_authorization_id.
// That makes the chain "request packet -> grant" navigable in both
// directions and audit-replayable via preauth.resulted_in_auth.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_DECISIONS = ['pending', 'approved', 'denied', 'expired'] as const

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

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const decision = typeof body.decision === 'string' ? body.decision : ''
  const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
  if (!(VALID_DECISIONS as readonly string[]).includes(decision)) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: `decision must be one of: ${VALID_DECISIONS.join(', ')}` } },
      { status: 400 },
    )
  }
  if (!summary) {
    return NextResponse.json({ error: { code: 'invalid_request', message: 'summary is required.' } }, { status: 400 })
  }

  const cur = await pool.query(
    `SELECT * FROM ehr_preauth_requests
      WHERE id = $1 AND practice_id = $2 AND patient_id = $3`,
    [reqId, ctx.practiceId, patientId],
  )
  if (cur.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const reqRow = cur.rows[0]
  if (!['submitted', 'pending'].includes(reqRow.status)) {
    return NextResponse.json(
      {
        error: {
          code: 'wrong_status',
          message: `Cannot record response on a request in status='${reqRow.status}'. Only submitted/pending requests are open for payer response.`,
        },
      },
      { status: 409 },
    )
  }

  // ---- approved path: spawn a W40 ehr_insurance_authorizations row -------
  let resultingAuthId: string | null = null
  if (decision === 'approved') {
    const authNumber = typeof body.auth_number === 'string' ? body.auth_number.trim() : ''
    const sessionsAuthorized = Number(body.sessions_authorized)
    if (!authNumber || !Number.isFinite(sessionsAuthorized) || sessionsAuthorized < 0) {
      return NextResponse.json(
        {
          error: {
            code: 'invalid_request',
            message: 'auth_number and sessions_authorized (>=0) are required when decision=approved.',
          },
        },
        { status: 400 },
      )
    }
    const validFrom = typeof body.valid_from === 'string' && body.valid_from ? body.valid_from : null
    const validTo = typeof body.valid_to === 'string' && body.valid_to ? body.valid_to : null
    const cptCovered = Array.isArray(body.cpt_codes_covered) && body.cpt_codes_covered.length > 0
      ? (body.cpt_codes_covered as unknown[]).map(v => String(v))
      : (reqRow.cpt_codes ?? [])

    try {
      const ins = await pool.query(
        `INSERT INTO ehr_insurance_authorizations
           (patient_id, practice_id, payer, auth_number,
            sessions_authorized, valid_from, valid_to,
            cpt_codes_covered, notes)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9)
         RETURNING id`,
        [
          patientId, ctx.practiceId, reqRow.payer_name, authNumber,
          sessionsAuthorized, validFrom, validTo,
          cptCovered,
          `Created from pre-auth request ${reqRow.id}. Payer notes: ${summary}`,
        ],
      )
      resultingAuthId = ins.rows[0].id
    } catch (err: any) {
      // Duplicate auth_number on this patient — return a structured 409 so
      // the UI can prompt the therapist to either edit the auth_number or
      // record the response without spawning a duplicate auth row.
      if (err?.code === '23505') {
        return NextResponse.json(
          {
            error: {
              code: 'duplicate_auth',
              message: `Auth number ${authNumber} already exists on this patient. Use the existing authorization or pick a different number.`,
              retryable: false,
            },
          },
          { status: 409 },
        )
      }
      throw err
    }
  }

  // Map decision -> request status. 'pending' is the only one that doesn't
  // close the loop: payer acknowledged but hasn't ruled.
  const newStatus =
    decision === 'pending'  ? 'pending'  :
    decision === 'approved' ? 'approved' :
    decision === 'denied'   ? 'denied'   :
    /* expired */             'expired'

  const upd = await pool.query(
    `UPDATE ehr_preauth_requests
        SET status = $1,
            payer_response_received_at = NOW(),
            payer_response_summary = $2,
            resulting_authorization_id = COALESCE($3, resulting_authorization_id)
      WHERE id = $4
      RETURNING *,
        requested_start_date::text AS requested_start_date,
        requested_end_date::text   AS requested_end_date`,
    [newStatus, summary, resultingAuthId, reqId],
  )

  await auditEhrAccess({
    ctx,
    action: 'preauth.record_response',
    resourceType: 'ehr_preauth_request',
    resourceId: reqId,
    details: {
      patient_id: patientId,
      decision,
      new_status: newStatus,
      resulting_authorization_id: resultingAuthId,
    },
  })

  if (resultingAuthId) {
    await auditEhrAccess({
      ctx,
      action: 'preauth.resulted_in_auth',
      resourceType: 'ehr_insurance_authorization',
      resourceId: resultingAuthId,
      details: { patient_id: patientId, preauth_request_id: reqId },
    })
  }

  return NextResponse.json({ preauth_request: upd.rows[0], resulting_authorization_id: resultingAuthId })
}

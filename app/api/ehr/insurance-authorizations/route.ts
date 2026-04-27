// app/api/ehr/insurance-authorizations/route.ts
//
// Wave 40 / P1 — list + create insurance authorizations.
//
// GET  → list, optionally filtered by patient_id + status.
// POST → create. Auth_number must be unique per patient (DB unique index).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_STATUSES = ['active', 'expired', 'exhausted', 'superseded'] as const

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const sp = req.nextUrl.searchParams
  const patientId = sp.get('patient_id')
  const status = sp.get('status')

  const conds: string[] = ['practice_id = $1']
  const args: unknown[] = [ctx.practiceId]
  if (patientId) {
    args.push(patientId)
    conds.push(`patient_id = $${args.length}`)
  }
  if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
    args.push(status)
    conds.push(`status = $${args.length}`)
  }

  const { rows } = await pool.query(
    `SELECT *, valid_from::text AS valid_from, valid_to::text AS valid_to
       FROM ehr_insurance_authorizations
      WHERE ${conds.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT 200`,
    args,
  )

  await auditEhrAccess({
    ctx,
    action: 'insurance_authorization.list',
    resourceType: 'ehr_insurance_authorization_list',
    resourceId: patientId,
    details: { count: rows.length, status_filter: status ?? null },
  })

  return NextResponse.json({ authorizations: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const patientId = typeof body.patient_id === 'string' ? body.patient_id : null
  const payer = typeof body.payer === 'string' ? body.payer.trim() : ''
  const authNumber = typeof body.auth_number === 'string' ? body.auth_number.trim() : ''
  const sessionsAuthorized = Number(body.sessions_authorized)
  if (!patientId || !payer || !authNumber || !Number.isFinite(sessionsAuthorized) || sessionsAuthorized < 0) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_request',
          message:
            'patient_id, payer, auth_number, and sessions_authorized (>=0) are required.',
        },
      },
      { status: 400 },
    )
  }

  const validFrom = typeof body.valid_from === 'string' ? body.valid_from : null
  const validTo = typeof body.valid_to === 'string' ? body.valid_to : null
  const cptCodes = Array.isArray(body.cpt_codes_covered)
    ? body.cpt_codes_covered.map((x) => String(x))
    : []
  const notes = typeof body.notes === 'string' ? body.notes : null

  try {
    const { rows } = await pool.query(
      `INSERT INTO ehr_insurance_authorizations
         (patient_id, practice_id, payer, auth_number,
          sessions_authorized, valid_from, valid_to,
          cpt_codes_covered, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *, valid_from::text AS valid_from, valid_to::text AS valid_to`,
      [
        patientId, ctx.practiceId, payer, authNumber,
        sessionsAuthorized, validFrom, validTo,
        cptCodes, notes,
      ],
    )

    await auditEhrAccess({
      ctx,
      action: 'insurance_authorization.create',
      resourceType: 'ehr_insurance_authorization',
      resourceId: rows[0].id,
      details: {
        patient_id: patientId,
        payer,
        auth_number: authNumber,
        sessions_authorized: sessionsAuthorized,
        cpt_codes_count: cptCodes.length,
      },
    })

    return NextResponse.json({ authorization: rows[0] }, { status: 201 })
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json(
        {
          error: {
            code: 'duplicate',
            message:
              `Auth number ${authNumber} already exists for this patient.`,
            retryable: false,
          },
        },
        { status: 409 },
      )
    }
    throw err
  }
}

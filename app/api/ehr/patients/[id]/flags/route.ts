// app/api/ehr/patients/[id]/flags/route.ts
//
// W49 D5 — list active flags + add a flag.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { isPatientFlagType } from '@/lib/ehr/patient-flags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const includeCleared = req.nextUrl.searchParams.get('include_cleared') === '1'
  const cond = includeCleared
    ? 'practice_id = $1 AND patient_id = $2'
    : 'practice_id = $1 AND patient_id = $2 AND cleared_at IS NULL'

  const { rows } = await pool.query(
    `SELECT id, type, notes, set_at, cleared_at, set_by_user_id, cleared_by_user_id
       FROM patient_flags
      WHERE ${cond}
      ORDER BY cleared_at IS NULL DESC, set_at DESC`,
    [ctx.practiceId, patientId],
  )

  await auditEhrAccess({
    ctx, action: 'patient_flag.list',
    resourceType: 'patient_flag', details: { patient_id: patientId, count: rows.length },
  })
  return NextResponse.json({ flags: rows })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  if (!isPatientFlagType(body.type)) return NextResponse.json({ error: 'invalid_type' }, { status: 400 })

  const p = await pool.query(`SELECT 1 FROM patients WHERE id = $1 AND practice_id = $2`, [patientId, ctx.practiceId])
  if (p.rows.length === 0) return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })

  const ins = await pool.query(
    `INSERT INTO patient_flags (practice_id, patient_id, type, notes, set_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (practice_id, patient_id, type) WHERE cleared_at IS NULL
       DO UPDATE SET notes = EXCLUDED.notes, set_at = NOW(), set_by_user_id = EXCLUDED.set_by_user_id
     RETURNING id, type, notes, set_at, cleared_at`,
    [ctx.practiceId, patientId, body.type, body.notes ? String(body.notes).slice(0, 1000) : null, ctx.user.id],
  )

  await auditEhrAccess({
    ctx, action: 'patient_flag.added',
    resourceType: 'patient_flag', resourceId: ins.rows[0].id,
    severity: body.type === 'suicide_risk' ? 'critical' : 'warning',
    details: { patient_id: patientId, type: body.type },
  })

  return NextResponse.json({ flag: ins.rows[0] }, { status: 201 })
}

// app/api/ehr/patients/[id]/care-team/route.ts
//
// Wave 42 / T4 — list + add care-team members.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { canManageCareTeam } from '@/lib/aws/ehr/care-team-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLES = new Set([
  'primary_therapist','supervising_psychiatrist','case_manager',
  'intern','consulting_provider',
])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const { rows } = await pool.query(
    `SELECT ct.*,
            COALESCE(u.full_name, u.email) AS user_name,
            u.email AS user_email
       FROM ehr_patient_care_team ct
       LEFT JOIN users u ON u.id = ct.user_id
      WHERE ct.practice_id = $1 AND ct.patient_id = $2
      ORDER BY ct.active DESC, ct.role ASC, u.last_name ASC NULLS LAST`,
    [ctx.practiceId, patientId],
  )

  await auditEhrAccess({
    ctx,
    action: 'care_team.list',
    resourceType: 'ehr_patient_care_team',
    resourceId: patientId,
    details: { count: rows.length },
  })

  return NextResponse.json({ members: rows })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const can = await canManageCareTeam({
    callerUserId: ctx.user.id,
    callerEmail: ctx.session.email,
    patientId,
    practiceId: ctx.practiceId!,
  })
  if (!can) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Only practice admins or existing supervisors can add care team members.',
        },
      },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const userId = typeof body.user_id === 'string' ? body.user_id : ''
  const role = typeof body.role === 'string' && ROLES.has(body.role) ? body.role : ''
  if (!userId || !role) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: `user_id and role (${[...ROLES].join('|')}) required` } },
      { status: 400 },
    )
  }
  const startedAt = typeof body.started_at === 'string' ? body.started_at : new Date().toISOString().slice(0, 10)
  const notes = typeof body.notes === 'string' ? body.notes : null

  // Verify the user is in the same practice (cross-practice add not allowed).
  const u = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [userId, ctx.practiceId],
  )
  if (u.rows.length === 0) {
    return NextResponse.json({ error: 'User not found in this practice' }, { status: 404 })
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO ehr_patient_care_team
         (patient_id, practice_id, user_id, role, started_at, notes, added_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [patientId, ctx.practiceId, userId, role, startedAt, notes, ctx.user.id],
    )

    await auditEhrAccess({
      ctx,
      action: 'care_team.added',
      resourceType: 'ehr_patient_care_team',
      resourceId: rows[0].id,
      details: { patient_id: patientId, user_id: userId, role },
    })

    return NextResponse.json({ member: rows[0] }, { status: 201 })
  } catch (err: any) {
    if (err?.code === '23505') {
      return NextResponse.json(
        { error: { code: 'duplicate', message: 'User is already on this patient\'s care team in that role.' } },
        { status: 409 },
      )
    }
    throw err
  }
}

// app/api/ehr/patients/[id]/care-team/[memberId]/route.ts
//
// Wave 42 / T4 — update or retire a care-team member.
// PATCH: change role, notes, ended_at. Toggle active=FALSE to retire.
// No DELETE — retirement preserves history.

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, memberId } = await params

  const can = await canManageCareTeam({
    callerUserId: ctx.user.id,
    callerEmail: ctx.session.email,
    patientId,
    practiceId: ctx.practiceId!,
  })
  if (!can) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Admin or supervisor only.' } },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const sets: string[] = []
  const args: unknown[] = []
  if (typeof body.role === 'string' && ROLES.has(body.role)) {
    args.push(body.role); sets.push(`role = $${args.length}`)
  }
  if (typeof body.active === 'boolean') {
    args.push(body.active); sets.push(`active = $${args.length}`)
    if (!body.active) {
      // Auto-stamp ended_at when active flips to FALSE.
      args.push(new Date().toISOString().slice(0, 10))
      sets.push(`ended_at = $${args.length}`)
    }
  }
  if ('ended_at' in body) {
    args.push(body.ended_at == null ? null : String(body.ended_at))
    sets.push(`ended_at = $${args.length}`)
  }
  if ('notes' in body) {
    args.push(body.notes == null ? null : String(body.notes))
    sets.push(`notes = $${args.length}`)
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no fields to update' }, { status: 400 })

  args.push(ctx.practiceId, patientId, memberId)
  const { rows } = await pool.query(
    `UPDATE ehr_patient_care_team
        SET ${sets.join(', ')}
      WHERE practice_id = $${args.length - 2}
        AND patient_id  = $${args.length - 1}
        AND id          = $${args.length}
      RETURNING *`,
    args,
  )
  if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Distinguish 'retired' vs 'updated' for cleaner forensic queries.
  const isRetirement = body.active === false
  await auditEhrAccess({
    ctx,
    action: isRetirement ? 'care_team.removed' : 'care_team.updated',
    resourceType: 'ehr_patient_care_team',
    resourceId: memberId,
    details: {
      patient_id: patientId,
      user_id: rows[0].user_id,
      role: rows[0].role,
      fields_changed: sets.map((s) => s.split(' ')[0]),
    },
  })

  return NextResponse.json({ member: rows[0] })
}

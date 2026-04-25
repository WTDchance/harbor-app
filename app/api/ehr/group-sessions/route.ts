// Harbor EHR — list + create group therapy sessions.
// Participants and per-patient notes live on a separate table (group
// session participants); this route is just the parent session row.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rows } = await pool.query(
    `SELECT id, title, group_type, scheduled_at, appointment_id, facilitator_id, created_at
       FROM ehr_group_sessions
      WHERE practice_id = $1
      ORDER BY scheduled_at DESC NULLS LAST, created_at DESC
      LIMIT 100`,
    [ctx.practiceId],
  )

  await auditEhrAccess({
    ctx,
    action: 'group_session.list',
    resourceType: 'ehr_group_session',
    details: { count: rows.length },
  })
  return NextResponse.json({ sessions: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.title) return NextResponse.json({ error: 'title required' }, { status: 400 })

  const { rows } = await pool.query(
    `INSERT INTO ehr_group_sessions (
       practice_id, title, group_type, facilitator_id, scheduled_at, appointment_id
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      ctx.practiceId,
      body.title,
      body.group_type ?? null,
      body.facilitator_id ?? null,
      body.scheduled_at ?? null,
      body.appointment_id ?? null,
    ],
  )
  const session = rows[0]

  await auditEhrAccess({
    ctx,
    action: 'group_session.create',
    resourceType: 'ehr_group_session',
    resourceId: session.id,
    details: { title: session.title, group_type: session.group_type },
  })
  return NextResponse.json({ session }, { status: 201 })
}

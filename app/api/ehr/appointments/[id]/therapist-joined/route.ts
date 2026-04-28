// app/api/ehr/appointments/[id]/therapist-joined/route.ts
//
// W47 T1 — therapist hit the meet page; stamp the timestamp so the
// patient waiting room auto-redirects on its next poll.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { rowCount } = await pool.query(
    `UPDATE appointments
        SET therapist_joined_meeting_at = COALESCE(therapist_joined_meeting_at, NOW())
      WHERE id = $1 AND practice_id = $2`,
    [params.id, ctx.practiceId],
  )
  if (rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'telehealth.waiting_room.therapist_joined',
    resourceType: 'appointment',
    resourceId: params.id,
    details: {},
  })
  return NextResponse.json({ ok: true })
}

// app/api/ehr/telehealth/[id]/end/route.ts
//
// W49 D2 — therapist ends the session. Sets ended_at and flips both
// statuses to 'left'. Idempotent.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  const upd = await pool.query(
    `UPDATE telehealth_sessions
        SET ended_at = COALESCE(ended_at, NOW()),
            patient_status = 'left',
            therapist_status = 'left',
            therapist_message = NULL
      WHERE id = $1 AND practice_id = $2
      RETURNING id, ended_at, patient_status, therapist_status`,
    [id, ctx.practiceId],
  )
  if (upd.rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'telehealth.session_ended',
    resourceType: 'telehealth_session',
    resourceId: id,
  })

  return NextResponse.json({ session: upd.rows[0] })
}

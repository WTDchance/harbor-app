// app/api/ehr/telehealth/[id]/admit/route.ts
//
// W49 D2 — therapist admits the patient. Flips patient_status to
// 'in_session' and therapist_status to 'in_session', records admitted_at.

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
        SET patient_status = CASE
              WHEN patient_status IN ('in_waiting','invited') THEN 'in_session'
              ELSE patient_status END,
            therapist_status = 'in_session',
            admitted_at = COALESCE(admitted_at, NOW())
      WHERE id = $1 AND practice_id = $2 AND ended_at IS NULL
      RETURNING id, patient_status, therapist_status, jitsi_room_id, admitted_at`,
    [id, ctx.practiceId],
  )
  if (upd.rows.length === 0) {
    return NextResponse.json({ error: 'session_not_found_or_ended' }, { status: 404 })
  }

  await auditEhrAccess({
    ctx,
    action: 'telehealth.patient_admitted',
    resourceType: 'telehealth_session',
    resourceId: id,
  })

  return NextResponse.json({ session: upd.rows[0] })
}

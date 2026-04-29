// app/api/portal/telehealth/[id]/leave/route.ts
//
// W49 D2 — patient explicitly leaves the waiting room.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess
  const { id: appointmentId } = await params

  const upd = await pool.query(
    `UPDATE telehealth_sessions
        SET patient_status = 'left'
      WHERE appointment_id = $1 AND practice_id = $2 AND ended_at IS NULL
      RETURNING id`,
    [appointmentId, sess.practiceId],
  )
  if (upd.rows.length > 0) {
    await auditPortalAccess({
      session: sess,
      action: 'telehealth.patient_left',
      resourceType: 'telehealth_session',
      resourceId: upd.rows[0].id,
    }).catch(() => null)
  }
  return NextResponse.json({ ok: true })
}

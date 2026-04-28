// app/api/ehr/appointments/[id]/reschedule-fill-candidates/route.ts
//
// W45 T4 — given a cancelled or freed appointment slot, return the
// ranked list of patients most likely to accept an offer to take it.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { rankRescheduleCandidates } from '@/lib/aws/ehr/predictions/reschedule'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  // Find the appointment so we know slot timing.
  const apptRes = await pool.query(
    `SELECT id, patient_id, scheduled_for, duration_minutes
       FROM appointments
      WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.id, ctx.practiceId],
  )
  const appt = apptRes.rows[0]
  if (!appt) return NextResponse.json({ error: 'appointment_not_found' }, { status: 404 })

  const exclude = appt.patient_id ? [appt.patient_id] : []
  const topN = Number(req.nextUrl.searchParams.get('top_n') || '25')

  const candidates = await rankRescheduleCandidates({
    practiceId: ctx.practiceId,
    slotTime: new Date(appt.scheduled_for),
    excludePatientIds: exclude,
    topN: Math.max(5, Math.min(100, topN)),
  })

  await auditEhrAccess({
    ctx,
    action: 'prediction.viewed',
    resourceType: 'reschedule_candidates',
    resourceId: params.id,
    details: { kind: 'reschedule_willingness', candidate_count: candidates.length },
  })

  return NextResponse.json({
    appointment_id: params.id,
    slot_time: appt.scheduled_for,
    duration_minutes: appt.duration_minutes,
    candidates,
  })
}

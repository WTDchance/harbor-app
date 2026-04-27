// Therapist-side mood log history for a single patient.
// patient_id is required (this view is always patient-scoped).

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { pool } from '@/lib/aws/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const patientId = req.nextUrl.searchParams.get('patient_id')
  if (!patientId) {
    return NextResponse.json({ error: 'patient_id required' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `SELECT id, mood, anxiety, sleep_hours, note, logged_at
       FROM ehr_mood_logs
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY logged_at ASC LIMIT 90`,
    [ctx.practiceId, patientId],
  )

  await auditEhrAccess({
    ctx,
    action: 'mood.list',
    resourceType: 'ehr_mood_logs',
    resourceId: patientId,
    details: { count: rows.length },
  })
  return NextResponse.json({ logs: rows })
}

// app/api/ehr/patients/[id]/call-signals/route.ts
//
// W50 D2 — return recent call signals for a patient, joined with the
// underlying call_logs row so the UI can show timestamp + caller info.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const limit = Math.min(200, Number(req.nextUrl.searchParams.get('limit')) || 50)

  const { rows } = await pool.query(
    `SELECT s.id, s.call_id::text, s.signal_type, s.signal_value, s.confidence,
            s.raw_excerpt, s.extracted_by, s.extracted_at,
            c.created_at AS call_at, c.duration_seconds, c.from_number, c.summary AS call_summary
       FROM ehr_call_signals s
       LEFT JOIN call_logs c ON c.id = s.call_id
      WHERE s.practice_id = $1
        AND s.patient_id = $2
      ORDER BY s.extracted_at DESC
      LIMIT $3`,
    [ctx.practiceId, patientId, limit],
  ).catch(() => ({ rows: [] as any[] }))

  await auditEhrAccess({
    ctx,
    action: 'note.view', // closest existing action — non-PHI signal stream
    resourceType: 'ehr_call_signal',
    details: { patient_id: patientId, count: rows.length },
  })

  return NextResponse.json({ signals: rows })
}

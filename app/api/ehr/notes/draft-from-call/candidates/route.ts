// app/api/ehr/notes/draft-from-call/candidates/route.ts
//
// Wave 17 (AWS port). Lists recent call_logs for a patient that have a
// transcript long enough to draft from. Used by the "Draft from call"
// modal on the patient detail.
//
// Read-only. Cognito + RDS pool. Practice-scoped. The call_logs table on
// RDS preserves the canonical legacy column names (patient_id,
// call_type, summary, transcript, crisis_detected, duration_seconds,
// created_at) so the SELECT is a near-verbatim port of the Supabase one.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

const MIN_TRANSCRIPT_LEN = 50

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  if (!patientId) {
    return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `SELECT id, created_at, duration_seconds, call_type, summary,
            transcript, crisis_detected
       FROM call_logs
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY created_at DESC
      LIMIT 25`,
    [ctx.practiceId, patientId],
  )

  // Strip transcript from the wire payload — therapist UI only needs to
  // know whether one exists. The draft route fetches the full text.
  const calls = rows
    .map((c) => ({
      id: c.id,
      created_at: c.created_at,
      duration_seconds: c.duration_seconds,
      call_type: c.call_type,
      summary: c.summary,
      has_transcript: !!(c.transcript && String(c.transcript).trim().length >= MIN_TRANSCRIPT_LEN),
      crisis_detected: c.crisis_detected,
    }))
    .filter((c) => c.has_transcript)

  await auditEhrAccess({
    ctx,
    action: 'note.draft.candidates.list',
    resourceType: 'call_log',
    resourceId: patientId,
    details: { patient_id: patientId, candidate_count: calls.length },
  })

  return NextResponse.json({ calls })
}

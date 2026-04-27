// app/api/ehr/patients/[id]/mse/route.ts
//
// Wave 39 / Task 1 — Mental Status Exam list + create.
//
// GET  → list MSEs for a patient (most recent first, capped at 50).
// POST → create a new draft MSE. Body fields are optional; the
//        therapist fills them in via subsequent PATCH calls.
//
// Auth: Cognito session via requireEhrApiSession; practice scope
// enforced in the WHERE clause + via the schema's RLS policies.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DOMAINS = [
  'appearance', 'behavior', 'speech', 'mood', 'affect',
  'thought_process', 'thought_content', 'perception',
  'cognition', 'insight', 'judgment',
] as const
type Domain = (typeof DOMAINS)[number]

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const { rows } = await pool.query(
    `SELECT id, patient_id, appointment_id, administered_by, administered_at,
            status, completed_at, created_at, updated_at,
            -- Domains included for the list page summary card.
            ${DOMAINS.join(', ')}, summary
       FROM ehr_mental_status_exams
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY administered_at DESC
      LIMIT 50`,
    [ctx.practiceId, patientId],
  )

  await auditEhrAccess({
    ctx,
    action: 'mental_status_exam.viewed',
    resourceType: 'ehr_mental_status_exam_list',
    resourceId: patientId,
    details: { count: rows.length },
  })

  return NextResponse.json({ exams: rows })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId } = await params

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const apptId = typeof body.appointment_id === 'string' ? body.appointment_id : null

  // Build initial-value list from any provided domains. All optional.
  const initialCols: string[] = []
  const initialVals: unknown[] = []
  for (const d of DOMAINS) {
    if (d in body) {
      initialCols.push(d)
      initialVals.push(body[d] == null ? null : String(body[d]))
    }
  }
  if ('summary' in body) {
    initialCols.push('summary')
    initialVals.push(body.summary == null ? null : String(body.summary))
  }

  const baseCols = ['practice_id', 'patient_id', 'administered_by', 'appointment_id']
  const baseVals: unknown[] = [ctx.practiceId, patientId, ctx.user.id, apptId]
  const allCols = [...baseCols, ...initialCols]
  const allVals = [...baseVals, ...initialVals]
  const placeholders = allVals.map((_, i) => `$${i + 1}`).join(', ')

  const { rows } = await pool.query(
    `INSERT INTO ehr_mental_status_exams (${allCols.join(', ')})
     VALUES (${placeholders})
     RETURNING *`,
    allVals,
  )
  const exam = rows[0]

  await auditEhrAccess({
    ctx,
    action: 'mental_status_exam.created',
    resourceType: 'ehr_mental_status_exam',
    resourceId: exam.id,
    details: { patient_id: patientId, appointment_id: apptId },
  })

  return NextResponse.json({ exam }, { status: 201 })
}

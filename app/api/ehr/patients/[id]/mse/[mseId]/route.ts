// app/api/ehr/patients/[id]/mse/[mseId]/route.ts
//
// Wave 39 / Task 1 — Mental Status Exam fetch + update.
//
// GET   → fetch one exam.
// PATCH → update fields (only allowed while status='draft'; once
//         completed, edits create amendments — handled by a future
//         amend endpoint, not this route).

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; mseId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, mseId } = await params

  const { rows } = await pool.query(
    `SELECT * FROM ehr_mental_status_exams
      WHERE practice_id = $1 AND patient_id = $2 AND id = $3
      LIMIT 1`,
    [ctx.practiceId, patientId, mseId],
  )
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await auditEhrAccess({
    ctx,
    action: 'mental_status_exam.viewed',
    resourceType: 'ehr_mental_status_exam',
    resourceId: mseId,
    details: { patient_id: patientId },
  })

  return NextResponse.json({ exam: rows[0] })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mseId: string }> },
) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id: patientId, mseId } = await params

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Only allow editing while status === 'draft'.
  const cur = await pool.query(
    `SELECT id, status FROM ehr_mental_status_exams
      WHERE practice_id = $1 AND patient_id = $2 AND id = $3
      LIMIT 1`,
    [ctx.practiceId, patientId, mseId],
  )
  if (cur.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (cur.rows[0].status !== 'draft') {
    return NextResponse.json(
      {
        error: {
          code: 'not_editable',
          message: 'Completed exams cannot be edited. Create an amendment instead.',
          retryable: false,
        },
      },
      { status: 409 },
    )
  }

  const sets: string[] = []
  const args: unknown[] = []
  for (const d of DOMAINS) {
    if (d in body) {
      args.push(body[d] == null ? null : String(body[d]))
      sets.push(`${d} = $${args.length}`)
    }
  }
  if ('summary' in body) {
    args.push(body.summary == null ? null : String(body.summary))
    sets.push(`summary = $${args.length}`)
  }
  if ('appointment_id' in body) {
    args.push(body.appointment_id == null ? null : String(body.appointment_id))
    sets.push(`appointment_id = $${args.length}`)
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  args.push(ctx.practiceId, patientId, mseId)
  const { rows } = await pool.query(
    `UPDATE ehr_mental_status_exams
        SET ${sets.join(', ')}
      WHERE practice_id = $${args.length - 2}
        AND patient_id  = $${args.length - 1}
        AND id          = $${args.length}
      RETURNING *`,
    args,
  )
  const exam = rows[0]
  if (!exam) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await auditEhrAccess({
    ctx,
    action: 'mental_status_exam.updated',
    resourceType: 'ehr_mental_status_exam',
    resourceId: mseId,
    details: {
      patient_id: patientId,
      fields_changed: sets.map((s) => s.split(' ')[0]),
    },
  })

  return NextResponse.json({ exam })
}

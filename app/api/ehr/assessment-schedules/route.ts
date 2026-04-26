// app/api/ehr/assessment-schedules/route.ts
//
// Wave 22 (AWS port). Therapist sets up (or stops) a recurring
// assessment for a patient. Cognito + pool. UPSERT on the
// (patient_id, assessment_type) unique constraint.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { getInstrument } from '@/lib/ehr/instruments'

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')

  const params: any[] = [ctx.practiceId]
  let where = `practice_id = $1`
  if (patientId) {
    params.push(patientId)
    where += ` AND patient_id = $${params.length}`
  }
  const { rows } = await pool.query(
    `SELECT id, patient_id, assessment_type, cadence_weeks, next_due_at,
            is_active, created_at
       FROM ehr_assessment_schedules
      WHERE ${where}
      ORDER BY created_at DESC`,
    params,
  )
  return NextResponse.json({ schedules: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.patient_id || !body?.assessment_type || !body?.cadence_weeks) {
    return NextResponse.json({ error: 'patient_id, assessment_type, cadence_weeks required' }, { status: 400 })
  }
  if (!getInstrument(body.assessment_type)) {
    return NextResponse.json({ error: 'Unknown instrument' }, { status: 400 })
  }
  const cadence = parseInt(body.cadence_weeks, 10)
  if (!Number.isInteger(cadence) || cadence < 1 || cadence > 52) {
    return NextResponse.json({ error: 'cadence_weeks must be 1-52' }, { status: 400 })
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO ehr_assessment_schedules
          (practice_id, patient_id, assessment_type, cadence_weeks,
           next_due_at, is_active, created_by)
        VALUES ($1, $2, $3, $4, NOW(), TRUE, $5)
        ON CONFLICT (patient_id, assessment_type) DO UPDATE
          SET cadence_weeks = EXCLUDED.cadence_weeks,
              next_due_at = EXCLUDED.next_due_at,
              is_active = TRUE
        RETURNING *`,
      [ctx.practiceId, body.patient_id, body.assessment_type, cadence, ctx.user.id],
    )

    await auditEhrAccess({
      ctx,
      action: 'note.create',
      resourceType: 'ehr_assessment_schedule',
      resourceId: rows[0].id,
      details: { kind: 'assessment_schedule', instrument: body.assessment_type, cadence_weeks: cadence },
    })

    return NextResponse.json({ schedule: rows[0] }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

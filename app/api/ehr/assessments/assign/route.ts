// app/api/ehr/assessments/assign/route.ts
//
// Wave 22 (AWS port). Therapist assigns an instrument to a patient.
// Creates a patient_assessments row with status='pending' that the
// patient will complete via their portal.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { getInstrument } from '@/lib/ehr/instruments'

const DEFAULT_WINDOW_DAYS = 14

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  if (!body?.patient_id || !body?.assessment_type) {
    return NextResponse.json({ error: 'patient_id and assessment_type required' }, { status: 400 })
  }
  const inst = getInstrument(body.assessment_type)
  if (!inst) return NextResponse.json({ error: `Unknown instrument ${body.assessment_type}` }, { status: 400 })

  const { rows: pRows } = await pool.query(
    `SELECT id, practice_id, first_name, last_name FROM patients
      WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [body.patient_id],
  )
  const patient = pRows[0]
  if (!patient || patient.practice_id !== ctx.practiceId) {
    return NextResponse.json({ error: 'Patient not found for this practice' }, { status: 404 })
  }

  const expiresMs = Date.now() + (body.window_days ?? DEFAULT_WINDOW_DAYS) * 24 * 60 * 60 * 1000

  try {
    const { rows } = await pool.query(
      `INSERT INTO patient_assessments
          (practice_id, patient_id, assessment_type, status,
           administered_by, completed_at, created_at)
        VALUES ($1, $2, $3, 'pending', $4, NULL, NOW())
        RETURNING *`,
      [ctx.practiceId, body.patient_id, inst.id, ctx.user.id],
    )

    await auditEhrAccess({
      ctx,
      action: 'note.create',
      resourceType: 'patient_assessment',
      resourceId: rows[0].id,
      details: {
        kind: 'assessment_assigned',
        instrument: inst.id,
        patient_id: patient.id,
        expires_at: new Date(expiresMs).toISOString(),
        via: body.via || 'portal',
      },
    })

    return NextResponse.json({ assessment: rows[0] }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

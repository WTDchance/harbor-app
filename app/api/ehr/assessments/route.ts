// Therapist-side assessment list + manual create (e.g. paper PHQ-9
// transcribed into the chart).
//
// GET requires ?patient_id= and returns all assessments for that patient
// in chronological order so the UI can chart trends.
//
// POST inserts a manually-administered assessment. Severity is inferred
// from instrument + score when not supplied.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function inferSeverity(type: string, score: number): string {
  const t = (type || '').toUpperCase()
  if (t.includes('PHQ-9') || t === 'PHQ9') {
    if (score >= 20) return 'severe'
    if (score >= 15) return 'moderately severe'
    if (score >= 10) return 'moderate'
    if (score >= 5) return 'mild'
    return 'minimal'
  }
  if (t.includes('GAD-7') || t === 'GAD7') {
    if (score >= 15) return 'severe'
    if (score >= 10) return 'moderate'
    if (score >= 5) return 'mild'
    return 'minimal'
  }
  if (t.includes('PHQ-2') || t === 'PHQ2' || t.includes('GAD-2') || t === 'GAD2') {
    return score >= 3 ? 'positive' : 'negative'
  }
  return 'unspecified'
}

export async function GET(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const patientId = req.nextUrl.searchParams.get('patient_id')
  if (!patientId) {
    return NextResponse.json({ error: 'patient_id required' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `SELECT id, assessment_type, score, severity, completed_at, created_at,
            administered_by, notes
       FROM patient_assessments
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY completed_at ASC NULLS LAST, created_at ASC`,
    [ctx.practiceId, patientId],
  )

  return NextResponse.json({ assessments: rows })
}

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null) as any
  if (!body?.patient_id || !body?.assessment_type || typeof body?.score !== 'number') {
    return NextResponse.json(
      { error: 'patient_id, assessment_type, score required' },
      { status: 400 },
    )
  }

  const severity = body.severity || inferSeverity(body.assessment_type, body.score)
  const { rows } = await pool.query(
    `INSERT INTO patient_assessments (
       practice_id, patient_id, assessment_type, score, severity,
       administered_by, notes, completed_at, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed')
     RETURNING *`,
    [
      ctx.practiceId, body.patient_id, body.assessment_type,
      body.score, severity,
      body.administered_by || 'therapist',
      body.notes ?? null,
      body.completed_at || new Date().toISOString(),
    ],
  )
  const assessment = rows[0]

  await auditEhrAccess({
    ctx,
    action: 'note.create', // no dedicated assessment.create enum entry; closest match
    resourceType: 'patient_assessment',
    resourceId: assessment.id,
    details: {
      kind: 'assessment_manual',
      type: body.assessment_type,
      score: body.score,
      severity,
    },
  })

  return NextResponse.json({ assessment }, { status: 201 })
}

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
  if (t === 'CSSRS' || t.includes('C-SSRS') || t.includes('CSSRS')) {
    if (score >= 6) return 'Suicidal behavior'
    if (score >= 5) return 'Active suicidal ideation with plan and intent'
    if (score >= 4) return 'Active suicidal ideation with intent'
    if (score >= 3) return 'Active suicidal ideation with method'
    if (score >= 2) return 'Non-specific active suicidal thoughts'
    if (score >= 1) return 'Wish to be dead'
    return 'No suicidal ideation or behavior reported'
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

  // Manual CSSRS entry at severity ≥ 5 → escalate risk_level to 'high'
  // and drop a crisis_alerts row, mirroring the portal completion path.
  const t = (body.assessment_type || '').toUpperCase()
  const isCssrs = t === 'CSSRS' || t.includes('C-SSRS')
  const isHighRisk = isCssrs && Number(body.score) >= 5
  if (isHighRisk) {
    await pool.query(
      `UPDATE patients
          SET risk_level = 'high'
        WHERE id = $1
          AND practice_id = $2
          AND (risk_level IS NULL OR risk_level NOT IN ('high','crisis'))`,
      [body.patient_id, ctx.practiceId],
    ).catch(err => console.error('[ehr/assessments] risk_level update failed', err))

    await pool.query(
      `INSERT INTO crisis_alerts (
         practice_id, patient_id, tier, matched_phrases, transcript_snippet
       ) VALUES (
         $1, $2, 2, $3::text[], $4
       )`,
      [
        ctx.practiceId, body.patient_id,
        [`CSSRS_severity_${body.score}`],
        `Therapist recorded C-SSRS at severity level ${body.score} (${severity}).`,
      ],
    ).catch(err => console.error('[ehr/assessments] crisis_alerts insert failed', err))
  }

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
      cssrs_high_risk: isHighRisk,
    },
  })

  return NextResponse.json({ assessment }, { status: 201 })
}

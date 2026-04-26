// app/api/outcomes/[token]/route.ts
//
// Wave 23 (AWS port). Public outcome-assessment by token. GET reveals
// the prompt; POST scores + persists. Pool only.

import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'

function calculateScore(responses: number[], type: 'phq9' | 'gad7') {
  const total = responses.reduce((sum, r) => sum + r, 0)
  let severity = ''
  if (type === 'phq9') {
    if (total <= 4) severity = 'minimal'
    else if (total <= 9) severity = 'mild'
    else if (total <= 14) severity = 'moderate'
    else if (total <= 19) severity = 'moderately_severe'
    else severity = 'severe'
  } else {
    if (total <= 4) severity = 'minimal'
    else if (total <= 9) severity = 'mild'
    else if (total <= 14) severity = 'moderate'
    else severity = 'severe'
  }
  return { score: total, severity }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const { rows } = await pool.query(
      `SELECT oa.status, oa.assessment_type, oa.practice_id, oa.patient_name, p.name AS practice_name
         FROM outcome_assessments oa
         LEFT JOIN practices p ON p.id = oa.practice_id
        WHERE oa.token = $1 LIMIT 1`,
      [token],
    )
    const data = rows[0]
    if (!data) return NextResponse.json({ error: 'Assessment not found or expired' }, { status: 404 })
    if (data.status === 'completed') {
      return NextResponse.json({ error: 'This assessment has already been completed' }, { status: 400 })
    }
    return NextResponse.json({
      assessment_type: data.assessment_type,
      patient_name: data.patient_name,
      practice_name: data.practice_name || 'Your Practice',
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const { responses } = await req.json()
    if (!Array.isArray(responses)) {
      return NextResponse.json({ error: 'responses array required' }, { status: 400 })
    }

    const { rows: aRows } = await pool.query(
      `SELECT id, status, assessment_type, practice_id, patient_id
         FROM outcome_assessments WHERE token = $1 LIMIT 1`,
      [token],
    )
    const assessment = aRows[0]
    if (!assessment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (assessment.status === 'completed') {
      return NextResponse.json({ error: 'Already completed' }, { status: 400 })
    }

    const type = assessment.assessment_type === 'gad7' ? 'gad7' : 'phq9'
    const { score, severity } = calculateScore(responses, type)

    await pool.query(
      `UPDATE outcome_assessments
          SET status = 'completed',
              responses = $1::jsonb,
              score = $2,
              severity = $3,
              completed_at = NOW()
        WHERE id = $4`,
      [JSON.stringify(responses), score, severity, assessment.id],
    )
    return NextResponse.json({ ok: true, score, severity })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

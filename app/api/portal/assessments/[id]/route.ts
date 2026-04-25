// Patient portal — fetch + complete a single assessment.
//
// GET — returns the existing assessment row + the full instrument
//        definition (questions + options) so the portal UI can render.
//        Auto-expires the row if expires_at is past and status is still
//        pending.
//
// POST — patient submits answers. Validates every question is answered
//        with a known option value, then calls scoreAndEvaluate (pure
//        helper from lib/ehr/instruments — no Supabase deps). Writes the
//        score, severity, alerts, and responses_json back. If a
//        suicidal_ideation alert fires (e.g. PHQ-9 item 9 endorsed),
//        also inserts a row into crisis_alerts so the crisis flow picks
//        it up.
//
// The scoreAndEvaluate logic is clinically meaningful — lifted verbatim
// via import, NOT reimplemented.

import { NextResponse, type NextRequest } from 'next/server'
import { requirePortalSession } from '@/lib/aws/portal-auth'
import { pool } from '@/lib/aws/db'
import { auditPortalAccess } from '@/lib/aws/ehr/audit'
import { getInstrument, scoreAndEvaluate } from '@/lib/ehr/instruments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess
  const { id } = await params

  const lookup = await pool.query(
    `SELECT * FROM patient_assessments
      WHERE id = $1 AND patient_id = $2 AND practice_id = $3
      LIMIT 1`,
    [id, sess.patientId, sess.practiceId],
  )
  const row = lookup.rows[0]
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Auto-expire stale pending assessments.
  if (
    row.expires_at &&
    new Date(row.expires_at).getTime() < Date.now() &&
    row.status === 'pending'
  ) {
    await pool.query(
      `UPDATE patient_assessments SET status = 'expired' WHERE id = $1`,
      [id],
    ).catch(() => {})
    return NextResponse.json(
      { error: 'This assessment has expired. Ask your therapist to reassign it.' },
      { status: 410 },
    )
  }

  const inst = getInstrument(row.assessment_type)
  if (!inst) {
    return NextResponse.json({ error: 'Unknown instrument' }, { status: 500 })
  }

  return NextResponse.json({
    assessment: {
      id: row.id,
      assessment_type: row.assessment_type,
      status: row.status,
      score: row.score,
      severity: row.severity,
      responses_json: row.responses_json,
      completed_at: row.completed_at,
    },
    instrument: {
      id: inst.id,
      name: inst.name,
      description: inst.description,
      instructions: inst.instructions,
      estimated_minutes: inst.estimated_minutes,
      max_score: inst.max_score,
      questions: inst.questions,
    },
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sess = await requirePortalSession()
  if (sess instanceof NextResponse) return sess
  const { id } = await params

  const body = await req.json().catch(() => null) as
    | { answers?: Record<string, number> }
    | null
  const answers = body?.answers
  if (!answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'answers object required' }, { status: 400 })
  }

  const lookup = await pool.query(
    `SELECT * FROM patient_assessments
      WHERE id = $1 AND patient_id = $2 AND practice_id = $3
      LIMIT 1`,
    [id, sess.patientId, sess.practiceId],
  )
  const row = lookup.rows[0]
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.status === 'completed') {
    return NextResponse.json({ error: 'Already completed' }, { status: 409 })
  }

  const inst = getInstrument(row.assessment_type)
  if (!inst) {
    return NextResponse.json({ error: 'Unknown instrument' }, { status: 500 })
  }

  // Every question must have an answer with a value matching one of its
  // declared options.
  for (const q of inst.questions) {
    const v = answers[q.id]
    if (typeof v !== 'number' || !q.options.some(o => o.value === v)) {
      return NextResponse.json(
        { error: `Question "${q.text}" not answered.` },
        { status: 400 },
      )
    }
  }

  // Pure scoring math — no DB, no LLM.
  const { score, severity, alerts } = scoreAndEvaluate(inst.id, answers)

  const completedAt = new Date().toISOString()
  const { rows } = await pool.query(
    `UPDATE patient_assessments
        SET status = 'completed',
            score = $1,
            severity = $2,
            responses_json = $3::jsonb,
            alerts_triggered = $4::jsonb,
            administered_via = 'portal',
            completed_at = $5
      WHERE id = $6
    RETURNING *`,
    [
      score, severity.label,
      JSON.stringify(answers), JSON.stringify(alerts),
      completedAt, id,
    ],
  )
  const updated = rows[0]

  // Suicidal-ideation alert → crisis_alerts row so the crisis flow picks
  // it up. AWS canonical crisis_alerts has tier/matched_phrases/
  // transcript_snippet rather than the legacy phrase/alert_status columns.
  // PHQ-9 item 9 endorsement is tier 2 by Harbor's existing rubric
  // (escalate to therapist, not active 988 emergency).
  const hasSuicidalAlert = alerts.some(a => a.type === 'suicidal_ideation')
  if (hasSuicidalAlert) {
    const score9 = (answers as Record<string, number>).phq9_9
    const snippet =
      typeof score9 === 'number'
        ? `Patient self-reported via portal PHQ-9, item 9 score = ${score9}.`
        : `Patient self-reported via portal ${inst.id} with suicidal-ideation alert.`
    await pool.query(
      `INSERT INTO crisis_alerts (
         practice_id, patient_id, tier, matched_phrases, transcript_snippet
       ) VALUES (
         $1, $2, 2, $3::text[], $4
       )`,
      [
        sess.practiceId, sess.patientId,
        [`${inst.id}_suicidal_ideation`],
        snippet,
      ],
    ).catch(err => console.error('[portal/assessments] crisis_alerts insert failed', err))
  }

  auditPortalAccess({
    session: sess,
    action: 'portal.assessment.complete',
    resourceType: 'patient_assessment',
    resourceId: id,
    details: {
      instrument: inst.id,
      score,
      severity: severity.label,
      alert_count: alerts.length,
      suicidal_alert: hasSuicidalAlert,
    },
  }).catch(() => {})

  return NextResponse.json({
    assessment: updated,
    score,
    severity,
    alerts,
  })
}

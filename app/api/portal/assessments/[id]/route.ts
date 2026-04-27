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

  // CSSRS Q6 follow-up: portal sends `cssrs_6_when` as an ISO date string
  // (or omits when Q6 = No). Convert to numeric `cssrs_6_recent` flag
  // (1 = within last 3 months, 0 = older) so the pure scoring function
  // stays Record<string, number>. The raw date is preserved verbatim in
  // responses_json for the chart and audit trail.
  let cssrs6When: string | null = null
  if (inst.id === 'CSSRS' && answers.cssrs_6 === 1) {
    const raw = (body as any)?.followups?.cssrs_6_when ?? null
    if (typeof raw === 'string' && raw.length > 0) {
      const when = new Date(raw)
      if (!Number.isNaN(when.getTime())) {
        cssrs6When = when.toISOString()
        const ageMs = Date.now() - when.getTime()
        const threeMonthsMs = 1000 * 60 * 60 * 24 * 92
        ;(answers as Record<string, number>).cssrs_6_recent = ageMs <= threeMonthsMs ? 1 : 0
      } else {
        // Default conservatively to "recent" if the date won't parse — better
        // to over-flag than under-flag suicidal behavior.
        ;(answers as Record<string, number>).cssrs_6_recent = 1
      }
    } else {
      // Q6 = Yes but no date provided → treat as recent (conservative).
      ;(answers as Record<string, number>).cssrs_6_recent = 1
    }
  }

  // Pure scoring math — no DB, no LLM.
  const { score, severity, alerts } = scoreAndEvaluate(inst.id, answers)

  const completedAt = new Date().toISOString()

  // Persist the verbatim follow-up date for CSSRS Q6 alongside the
  // numeric answers so the chart/audit trail keeps it.
  const responsesPayload: Record<string, unknown> = { ...answers }
  if (cssrs6When) responsesPayload.cssrs_6_when = cssrs6When

  // Subscale scores: CSSRS uses ordinal severity, so we record the
  // highest-severity yes (the score itself) plus per-question yes/no in
  // subscale_scores so the symptom breakdown can render historical rows
  // without re-running the scoring fn.
  const subscaleScores =
    inst.id === 'CSSRS'
      ? {
          severity_level: score,
          q1_wish_dead: answers.cssrs_1 ?? 0,
          q2_active_thoughts: answers.cssrs_2 ?? 0,
          q3_method: answers.cssrs_3 ?? 0,
          q4_intent: answers.cssrs_4 ?? 0,
          q5_plan_intent: answers.cssrs_5 ?? 0,
          q6_behavior: answers.cssrs_6 ?? 0,
          q6_recent: (answers as Record<string, number>).cssrs_6_recent ?? null,
          q6_when: cssrs6When,
        }
      : null

  const { rows } = await pool.query(
    `UPDATE patient_assessments
        SET status = 'completed',
            score = $1,
            severity = $2,
            responses_json = $3::jsonb,
            alerts_triggered = $4::jsonb,
            subscale_scores = $5::jsonb,
            administered_via = 'portal',
            completed_at = $6
      WHERE id = $7
    RETURNING *`,
    [
      score, severity.label,
      JSON.stringify(responsesPayload), JSON.stringify(alerts),
      subscaleScores ? JSON.stringify(subscaleScores) : null,
      completedAt, id,
    ],
  )
  const updated = rows[0]

  // CSSRS high-severity escalation: severity ≥ 5 (Q5 plan+intent) OR
  // any Q6 endorsement (suicidal behavior, lifetime or recent) raises
  // the patient's risk_level to 'high' so the Today screen and the
  // patient profile both surface the crisis card. We only ever raise
  // risk_level here — never lower it from a lower-risk assessment, so
  // a clean PHQ-9 doesn't undo a prior CSSRS escalation.
  const isCssrsHighRisk =
    inst.id === 'CSSRS' && (score >= 5 || (answers.cssrs_6 ?? 0) === 1)
  if (isCssrsHighRisk) {
    await pool.query(
      `UPDATE patients
          SET risk_level = 'high'
        WHERE id = $1
          AND practice_id = $2
          AND (risk_level IS NULL OR risk_level NOT IN ('high','crisis'))`,
      [sess.patientId, sess.practiceId],
    ).catch(err => console.error('[portal/assessments] risk_level update failed', err))

    const isRecentBehavior =
      (answers.cssrs_6 ?? 0) === 1 && (answers as Record<string, number>).cssrs_6_recent === 1
    const tier = isRecentBehavior ? 1 : 2
    const phrases = [
      `${inst.id}_severity_${score}`,
      ...(isRecentBehavior ? ['cssrs_q6_recent_behavior'] : []),
      ...((answers.cssrs_5 ?? 0) === 1 ? ['cssrs_q5_plan_and_intent'] : []),
    ]
    const snippet = isRecentBehavior
      ? `Patient self-reported via portal C-SSRS Q6: suicidal behavior within last 3 months. Severity level ${score}.`
      : `Patient self-reported via portal C-SSRS at severity level ${score} (${severity.label}).`
    await pool.query(
      `INSERT INTO crisis_alerts (
         practice_id, patient_id, tier, matched_phrases, transcript_snippet
       ) VALUES (
         $1, $2, $3, $4::text[], $5
       )`,
      [sess.practiceId, sess.patientId, tier, phrases, snippet],
    ).catch(err => console.error('[portal/assessments] crisis_alerts insert failed', err))
  }

  // Suicidal-ideation alert → crisis_alerts row so the crisis flow picks
  // it up. AWS canonical crisis_alerts has tier/matched_phrases/
  // transcript_snippet rather than the legacy phrase/alert_status columns.
  // PHQ-9 item 9 endorsement is tier 2 by Harbor's existing rubric
  // (escalate to therapist, not active 988 emergency).
  // Skip when CSSRS already inserted a more specific crisis_alerts row above.
  const hasSuicidalAlert = alerts.some(a => a.type === 'suicidal_ideation')
  if (hasSuicidalAlert && !isCssrsHighRisk) {
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
      cssrs_high_risk: isCssrsHighRisk,
      cssrs_q6_recent:
        inst.id === 'CSSRS' && answers.cssrs_6 === 1
          ? (answers as Record<string, number>).cssrs_6_recent === 1
          : undefined,
    },
  }).catch(() => {})

  return NextResponse.json({
    assessment: updated,
    score,
    severity,
    alerts,
  })
}

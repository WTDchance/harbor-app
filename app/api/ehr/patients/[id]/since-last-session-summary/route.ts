// app/api/ehr/patients/[id]/since-last-session-summary/route.ts
//
// W46 T1 — generate a "since last session" summary using Bedrock
// Sonnet, grounded in real chart data: assessment trends, attendance,
// W45 prediction trend, no safety concerns / safety concerns flag.
//
// Therapist-facing only (admin/audit boundary makes this clearly
// non-patient-facing, so the no-AI-on-patient-surfaces rule doesn't
// apply). Output is a 2-3 sentence factual summary, NOT clinical
// recommendations.

import { NextResponse, type NextRequest } from 'next/server'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { pool } from '@/lib/aws/db'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { createMessage } from '@/lib/aws/llm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Inputs = {
  last_session_date: string | null
  next_session_date: string | null
  recent_phq9: { score: number; date: string }[]
  recent_gad7: { score: number; date: string }[]
  attendance_last_5: Array<'kept' | 'no_show' | 'late_cancel' | 'cancelled' | 'scheduled'>
  homework_completion_30d: { done: number; missed: number } | null
  no_show_trend: { delta: number; latest: number } | null
  safety_flags: string[]
}

async function gatherInputs(practiceId: string, patientId: string): Promise<Inputs> {
  const last = await pool.query(
    `SELECT scheduled_for::text FROM appointments
      WHERE practice_id = $1 AND patient_id = $2 AND status = 'completed'
      ORDER BY scheduled_for DESC LIMIT 1`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [] as any[] }))

  const next = await pool.query(
    `SELECT scheduled_for::text FROM appointments
      WHERE practice_id = $1 AND patient_id = $2 AND status IN ('scheduled','confirmed')
        AND scheduled_for >= NOW()
      ORDER BY scheduled_for ASC LIMIT 1`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [] as any[] }))

  const phq9 = await pool.query(
    `SELECT total_score::int AS score, completed_at::text AS date
       FROM outcome_assessments
      WHERE practice_id = $1 AND patient_id = $2
        AND instrument = 'PHQ-9' AND completed_at IS NOT NULL
      ORDER BY completed_at DESC LIMIT 3`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [] as any[] }))

  const gad7 = await pool.query(
    `SELECT total_score::int AS score, completed_at::text AS date
       FROM outcome_assessments
      WHERE practice_id = $1 AND patient_id = $2
        AND instrument = 'GAD-7' AND completed_at IS NOT NULL
      ORDER BY completed_at DESC LIMIT 3`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [] as any[] }))

  const attendance = await pool.query(
    `SELECT status, late_canceled_at FROM appointments
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY scheduled_for DESC LIMIT 5`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [] as any[] }))

  const noShowTrend = await pool.query(
    `WITH recent AS (
       SELECT score::float, computed_at
         FROM ehr_patient_predictions
        WHERE practice_id = $1 AND patient_id = $2
          AND prediction_kind = 'no_show'
        ORDER BY computed_at DESC LIMIT 5
     )
     SELECT (SELECT score FROM recent ORDER BY computed_at DESC LIMIT 1)             AS latest,
            (SELECT score FROM recent ORDER BY computed_at DESC OFFSET 4 LIMIT 1)    AS oldest`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [] as any[] }))

  const safety = await pool.query(
    `SELECT severity, summary FROM crisis_alerts
      WHERE practice_id = $1 AND patient_id = $2
      ORDER BY created_at DESC LIMIT 3`,
    [practiceId, patientId],
  ).catch(() => ({ rows: [] as any[] }))

  const trendRow = noShowTrend.rows[0]
  return {
    last_session_date: last.rows[0]?.scheduled_for || null,
    next_session_date: next.rows[0]?.scheduled_for || null,
    recent_phq9: phq9.rows,
    recent_gad7: gad7.rows,
    attendance_last_5: attendance.rows.map((r: any) =>
      r.late_canceled_at ? 'late_cancel' : r.status),
    homework_completion_30d: null,
    no_show_trend: trendRow && trendRow.latest != null
      ? { latest: Number(trendRow.latest), delta: trendRow.oldest != null ? Number(trendRow.latest) - Number(trendRow.oldest) : 0 }
      : null,
    safety_flags: safety.rows.map((r: any) => `${r.severity}: ${r.summary}`).filter(Boolean),
  }
}

const SYSTEM_PROMPT = `
You are summarizing a therapy patient's chart for the therapist before
their next session. You are NOT making clinical recommendations or
suggesting treatment. State only what the data shows. 2-3 sentences,
factual, in past tense for what happened and present tense for current
metrics. If a metric is missing, omit it — do not say "not available".
End with "No safety concerns." when safety_flags is empty; otherwise
state the most recent flag.
`.trim()

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const pCheck = await pool.query(
    `SELECT id FROM patients WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [params.id, ctx.practiceId],
  )
  if (pCheck.rows.length === 0) {
    return NextResponse.json({ error: 'patient_not_found' }, { status: 404 })
  }

  const inputs = await gatherInputs(ctx.practiceId, params.id)

  const userMsg = `Chart inputs:\n${JSON.stringify(inputs, null, 2)}\n\nReturn the summary now.`

  let summary = ''
  try {
    const resp = await createMessage({
      max_tokens: 250,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: userMsg }] }],
    })
    summary = resp.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n')
      .trim()
  } catch (err) {
    return NextResponse.json(
      { error: 'summary_generation_failed', detail: (err as Error).message },
      { status: 502 },
    )
  }

  await auditEhrAccess({
    ctx,
    action: 'patient.since_last_session.summary_generated',
    resourceType: 'patient',
    resourceId: params.id,
    details: {
      summary_chars: summary.length,
      had_safety_flags: inputs.safety_flags.length > 0,
      had_phq9: inputs.recent_phq9.length > 0,
      had_gad7: inputs.recent_gad7.length > 0,
    },
  })

  return NextResponse.json({ summary, inputs_seen: {
    has_last_session: !!inputs.last_session_date,
    has_next_session: !!inputs.next_session_date,
    phq9_points: inputs.recent_phq9.length,
    gad7_points: inputs.recent_gad7.length,
    safety_flag_count: inputs.safety_flags.length,
  }})
}

// app/api/ehr/assessments/interpret/route.ts
//
// Wave 17 (AWS port). Sonnet-powered clinical interpretation of a
// patient's assessment trend. Therapist clicks "Interpret with AI" on
// the Assessments card; we pull the last N completed scores + patient
// context + active treatment plan + recent notes, and ask Sonnet for
// a short clinical summary the therapist can paste into a progress
// note (after review).
//
// SYSTEM PROMPT lifted bit-for-bit from lib/ehr/assessment-interpret.ts.
//
// Per-practice daily cap of 100 (shared with other AI side-effects via
// lib/aws/ehr/draft-rate-limit checkAiRateLimit('assessment.interpret')).
//
// Persists the interpretation back onto the most recent
// patient_assessments row (interpretation + interpretation_generated_at
// columns, added in Wave 17 schema bump). Wrapped in try/catch so DBs
// without the columns still return text.

import { createMessage } from '@/lib/aws/llm'
import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { checkAiRateLimit } from '@/lib/aws/ehr/draft-rate-limit'
import { getInstrument } from '@/lib/ehr/instruments'

const SYSTEM_PROMPT = `You are a clinical consult assistant helping a licensed therapist interpret their patient's assessment trajectory.

You will receive:
- The instrument (e.g. PHQ-9), its severity bands, and the max score.
- The patient's full score history (date + score + severity).
- Optional item-level responses from the most recent administration.
- Optional treatment-plan goals and recent note summaries.
- Optional patient demographics / presenting problem.

Produce a brief, clinical interpretation — 3 to 5 short paragraphs — covering:
1. Direction of change (improving, stable, worsening) with magnitudes.
2. Clinical significance of the change (use the instrument's conventions;
   e.g. for PHQ-9 a 5-point decrease is typically considered a response;
   a drop below 5 is remission).
3. Item-level patterns, if provided — which symptoms are driving the score
   now vs. previously, and any items that warrant clinical attention
   (especially PHQ-9 item 9).
4. Alignment with treatment plan (if provided) — are goals being met?
5. Clinical recommendations — consider assessment timing, augmentation,
   safety planning if warranted.

Strict rules:
- DO NOT diagnose or prescribe. The therapist is the clinician of record.
- DO NOT invent scores or item content not provided.
- DO NOT minimize risk. If item 9 of PHQ-9 was positive, lead with it.
- Use neutral clinical language. Write as peer consultation, not report.
- Keep the whole response under 300 words.`

export async function POST(req: NextRequest) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx

  const body = await req.json().catch(() => null)
  const patientId = body?.patient_id
  const instrumentId = body?.assessment_type
  if (!patientId || !instrumentId) {
    return NextResponse.json({ error: 'patient_id and assessment_type required' }, { status: 400 })
  }

  // LLM provider wrapped by lib/aws/llm — Bedrock by default.

  const inst = getInstrument(instrumentId)
  if (!inst) {
    return NextResponse.json({ error: 'Unknown instrument' }, { status: 400 })
  }

  // Per-practice daily cap. assessment.interpret is its own family.
  const cap = await checkAiRateLimit(ctx.practiceId!, 'assessment.interpret')
  if (!cap.allowed) {
    return NextResponse.json(
      { error: 'daily_cap_reached', cap: cap.cap, used: cap.used },
      { status: 429 },
    )
  }

  const [patient, assessments, plan, recentNotes] = await Promise.all([
    pool.query(
      `SELECT first_name, last_name, presenting_concerns
         FROM patients
        WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [patientId, ctx.practiceId],
    ),
    pool.query(
      `SELECT id, score, severity, responses_json, completed_at, alerts_triggered
         FROM patient_assessments
        WHERE practice_id = $1 AND patient_id = $2
          AND assessment_type = $3 AND status = 'completed'
        ORDER BY completed_at ASC NULLS LAST
        LIMIT 20`,
      [ctx.practiceId, patientId, inst.id],
    ),
    pool.query(
      `SELECT presenting_problem, goals, frequency, start_date
         FROM ehr_treatment_plans
        WHERE practice_id = $1 AND patient_id = $2 AND status = 'active'
        ORDER BY created_at DESC LIMIT 1`,
      [ctx.practiceId, patientId],
    ),
    pool.query(
      `SELECT title, assessment, plan, created_at FROM ehr_progress_notes
        WHERE practice_id = $1 AND patient_id = $2
          AND status IN ('signed','amended')
        ORDER BY created_at DESC LIMIT 3`,
      [ctx.practiceId, patientId],
    ),
  ])

  if (assessments.rows.length === 0) {
    return NextResponse.json({ error: 'No completed assessments of this type yet' }, { status: 400 })
  }

  const trend = assessments.rows.map((a: any) => ({
    date: a.completed_at ? new Date(a.completed_at).toLocaleDateString() : null,
    score: a.score,
    severity: a.severity,
    alerts: a.alerts_triggered,
  }))

  const latest = assessments.rows[assessments.rows.length - 1]
  const latestResponses = latest.responses_json
    ? inst.questions.map((q) => ({ item: q.text, score: (latest.responses_json as any)[q.id] ?? null }))
    : null

  const contextBlocks: string[] = []
  contextBlocks.push(`Instrument: ${inst.id} — ${inst.name}`)
  contextBlocks.push(`Max score: ${inst.max_score}`)
  contextBlocks.push(`Severity bands: ${inst.bands.map((b) => `${b.min}-${b.max} ${b.label}`).join('; ')}`)
  if (patient.rows[0]) {
    const p = patient.rows[0]
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ')
    if (name) contextBlocks.push(`Patient: ${name}`)
    const presenting = Array.isArray(p.presenting_concerns) && p.presenting_concerns.length
      ? p.presenting_concerns.join('; ')
      : ''
    if (presenting) contextBlocks.push(`Reason for seeking care: ${presenting}`)
  }
  contextBlocks.push(
    `\nScore history (chronological):\n${trend
      .map((t) => `  ${t.date ?? '?'}: ${t.score} (${t.severity ?? ''})${t.alerts && Array.isArray(t.alerts) && t.alerts.length ? '  ALERT: ' + JSON.stringify(t.alerts) : ''}`)
      .join('\n')}`,
  )
  if (latestResponses) {
    contextBlocks.push(
      `\nMost recent item-level responses:\n${latestResponses.map((r) => `  [${r.score}] ${r.item}`).join('\n')}`,
    )
  }
  if (plan.rows[0]) {
    const tp = plan.rows[0]
    contextBlocks.push(
      `\nActive treatment plan:\n  Presenting: ${tp.presenting_problem || 'n/a'}\n  Frequency: ${tp.frequency || 'n/a'}\n  Goals: ${(tp.goals || []).map((g: any) => `- ${g.text ?? g}`).join('\n    ')}`,
    )
  }
  if (recentNotes.rows.length) {
    contextBlocks.push(
      `\nRecent notes (assessment + plan sections only):\n${recentNotes.rows
        .map((n: any) => `  [${new Date(n.created_at).toLocaleDateString()}] ${n.title}\n    A: ${(n.assessment || '').slice(0, 200)}\n    P: ${(n.plan || '').slice(0, 200)}`)
        .join('\n')}`,
    )
  }

  const resp = await createMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: contextBlocks.join('\n') }],
  })

  const text = resp.content
    .filter(b => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  // Persist interpretation onto the most recent completed row so it
  // shows next to the score in the UI. Wave 17 schema bump adds the
  // columns; wrap in try/catch so unmigrated DBs still return text.
  let appliedToId: string | null = null
  try {
    const upd = await pool.query(
      `UPDATE patient_assessments
          SET interpretation = $1,
              interpretation_generated_at = NOW()
        WHERE id = $2 AND practice_id = $3
        RETURNING id`,
      [text, latest.id, ctx.practiceId],
    )
    appliedToId = upd.rows[0]?.id ?? null
  } catch (err) {
    console.error('[assessment-interpret] cache write failed:', (err as Error).message)
  }

  await auditEhrAccess({
    ctx,
    action: 'assessment.interpret',
    resourceType: 'patient_assessment',
    resourceId: appliedToId ?? latest.id ?? patientId,
    details: {
      patient_id: patientId,
      instrument: inst.id,
      trend_length: trend.length,
      cap_used: cap.used + 1,
      model: 'claude-sonnet-4-6',
    },
  })

  return NextResponse.json({ interpretation: text, applied_to_id: appliedToId })
}

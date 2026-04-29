// app/api/ehr/patients/[id]/summary/route.ts
//
// Wave 17 (AWS port). Sonnet writes a 3-5 sentence snapshot of the
// patient from intake reason + recent calls + assessment trajectory +
// last signed note + recent mood + open homework + upcoming appointment
// + active safety plan + recent crisis alerts.
//
// Cached on patients.ai_summary so therapist's repeat profile visits
// don't burn the Anthropic API. "Regenerate" button calls POST again.
//
// SYSTEM PROMPT lifted bit-for-bit from lib/ehr/patient-summary.ts.
// Per-practice daily cap of 100 (shared with other AI side-effects via
// lib/aws/ehr/draft-rate-limit checkAiRateLimit('patient.summary.%')).
//
// Schema mappings:
//   - appointments.scheduled_for replaces appointment_date+appointment_time
//     and the upcoming-appointment block uses scheduled_for + interval
//   - patients.presenting_concerns (TEXT[]) replaces reason_for_seeking
//   - crisis_alerts.created_at (was triggered_at on legacy)

import { createMessage } from '@/lib/aws/llm'
import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireEhrApiSession } from '@/lib/aws/api-auth'
import { auditEhrAccess } from '@/lib/aws/ehr/audit'
import { checkAiRateLimit } from '@/lib/aws/ehr/draft-rate-limit'

const SYSTEM_PROMPT = `You are briefing a licensed therapist before they walk into a session. Write a 3-5 sentence snapshot of the patient using ONLY the data provided. Do not invent history, quotes, or clinical observations that weren't in the source material.

Cover (in any order that reads naturally):
- Who they are: a one-line demographic + presenting reason.
- Where they are clinically: direction of change on measures, any recent risk signal, and the broad symptom picture.
- What's next: what the last note's plan said, what homework is open, any upcoming appointment.
- What the therapist should hold in mind going in: themes, patterns, recent life events mentioned.

Hard rules:
- Third person. Neutral clinical register, not jargon-heavy.
- Under 120 words.
- Lead with any active safety flag (suicidal ideation on PHQ-9, active safety plan, crisis alert within the last week). Never bury it.
- Do not diagnose. Do not prescribe. Do not recommend medication.
- If the record is nearly empty (new intake, no sessions yet), say so plainly — do not fabricate a clinical picture.`

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  // LLM provider wrapped by lib/aws/llm — Bedrock by default.

  // Per-practice daily cap. patient.summary.% is its own family so a
  // therapist binge-generating SOAP drafts doesn't lock summary
  // regeneration (and vice versa).
  const cap = await checkAiRateLimit(ctx.practiceId!, 'patient.summary.%')
  if (!cap.allowed) {
    return NextResponse.json(
      { error: 'daily_cap_reached', cap: cap.cap, used: cap.used },
      { status: 429 },
    )
  }

  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const todayIso = new Date().toISOString()

  const [patient, calls, assessments, lastNote, mood, hwOpen, upcomingAppt, safety, recentCrisis] = await Promise.all([
    pool.query(
      `SELECT first_name, last_name, date_of_birth, presenting_concerns,
              insurance_provider, referral_source
         FROM patients
        WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [id, ctx.practiceId],
    ),
    pool.query(
      `SELECT summary, created_at, call_type FROM call_logs
        WHERE practice_id = $1 AND patient_id = $2
        ORDER BY created_at DESC LIMIT 3`,
      [ctx.practiceId, id],
    ),
    pool.query(
      `SELECT assessment_type, score, severity, completed_at, alerts_triggered
         FROM patient_assessments
        WHERE practice_id = $1 AND patient_id = $2 AND status = 'completed'
        ORDER BY completed_at ASC NULLS LAST
        LIMIT 10`,
      [ctx.practiceId, id],
    ),
    pool.query(
      `SELECT title, assessment, plan, created_at FROM ehr_progress_notes
        WHERE practice_id = $1 AND patient_id = $2
          AND status IN ('signed','amended')
        ORDER BY created_at DESC LIMIT 1`,
      [ctx.practiceId, id],
    ),
    pool.query(
      `SELECT mood, anxiety, note, logged_at FROM ehr_mood_logs
        WHERE practice_id = $1 AND patient_id = $2
        ORDER BY logged_at DESC LIMIT 5`,
      [ctx.practiceId, id],
    ),
    pool.query(
      `SELECT title, due_date FROM ehr_homework
        WHERE practice_id = $1 AND patient_id = $2 AND status = 'assigned'
        LIMIT 3`,
      [ctx.practiceId, id],
    ),
    pool.query(
      `SELECT scheduled_for, appointment_type FROM appointments
        WHERE practice_id = $1 AND patient_id = $2
          AND status IN ('scheduled','confirmed')
          AND scheduled_for >= $3
        ORDER BY scheduled_for ASC LIMIT 1`,
      [ctx.practiceId, id, todayIso],
    ),
    pool.query(
      `SELECT status FROM ehr_safety_plans
        WHERE practice_id = $1 AND patient_id = $2 AND status = 'active'
        LIMIT 1`,
      [ctx.practiceId, id],
    ),
    pool.query(
      `SELECT id, created_at FROM crisis_alerts
        WHERE practice_id = $1 AND patient_id = $2 AND created_at >= $3
        LIMIT 3`,
      [ctx.practiceId, id, sevenDaysAgoIso],
    ),
  ])

  if (patient.rowCount === 0) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  }
  const p = patient.rows[0]

  const blocks: string[] = []
  const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown'
  blocks.push(`Patient: ${fullName}${p.date_of_birth ? ` (DOB ${p.date_of_birth})` : ''}`)
  const presenting = Array.isArray(p.presenting_concerns) && p.presenting_concerns.length
    ? p.presenting_concerns.join('; ')
    : ''
  if (presenting) blocks.push(`Reason for seeking care: ${presenting}`)
  if (p.referral_source) blocks.push(`Referral source: ${p.referral_source}`)
  if (p.insurance_provider) blocks.push(`Insurance: ${p.insurance_provider}`)

  if (safety.rowCount && safety.rowCount > 0) {
    blocks.push(`SAFETY: An active Stanley-Brown safety plan is on file. Treat as ongoing risk context.`)
  }
  if (recentCrisis.rowCount && recentCrisis.rowCount > 0) {
    blocks.push(`CRISIS: ${recentCrisis.rowCount} crisis alert(s) logged in the last 7 days.`)
  }

  if (assessments.rows.length > 0) {
    const byType = new Map<string, Array<{ score: number; date: string; alerts: any }>>()
    for (const a of assessments.rows) {
      const key = a.assessment_type
      if (!byType.has(key)) byType.set(key, [])
      byType.get(key)!.push({
        score: a.score,
        date: a.completed_at ? new Date(a.completed_at).toLocaleDateString() : '',
        alerts: a.alerts_triggered,
      })
    }
    blocks.push('\nAssessment trajectory:')
    for (const [type, rows] of byType) {
      const first = rows[0]
      const last = rows[rows.length - 1]
      const delta = rows.length > 1
        ? ` (baseline ${first.score} → latest ${last.score}, Δ${last.score - first.score >= 0 ? '+' : ''}${last.score - first.score})`
        : ` (${last.score})`
      const hasAlerts = rows.some((r) => Array.isArray(r.alerts) && r.alerts.length > 0)
      blocks.push(`  - ${type}${delta}${hasAlerts ? ' · ALERT present' : ''}`)
    }
  }

  if (mood.rows.length > 0) {
    const avg = mood.rows.reduce((s, m: any) => s + (m.mood ?? 0), 0) / mood.rows.length
    const latest = mood.rows[0]
    blocks.push(`\nRecent mood check-ins: avg ${avg.toFixed(1)}/10 (latest ${latest.mood}). ${latest.note ? `Last note: "${latest.note}"` : ''}`)
  }

  if (calls.rows.length > 0) {
    blocks.push(`\nRecent call contacts:`)
    for (const c of calls.rows.slice(0, 2)) {
      if (c.summary) {
        blocks.push(`  - [${c.call_type ?? 'call'}, ${new Date(c.created_at).toLocaleDateString()}] ${String(c.summary).slice(0, 220)}`)
      }
    }
  }

  if (lastNote.rowCount && lastNote.rows[0]) {
    const n = lastNote.rows[0]
    blocks.push(`\nMost recent signed note · ${new Date(n.created_at).toLocaleDateString()}:`)
    if (n.assessment) blocks.push(`  Assessment: ${String(n.assessment).slice(0, 300)}`)
    if (n.plan) blocks.push(`  Plan: ${String(n.plan).slice(0, 300)}`)
  }

  if (hwOpen.rows.length > 0) {
    blocks.push(`\nOpen homework: ${hwOpen.rows.map((h: any) => h.title).join('; ')}`)
  }

  if (upcomingAppt.rowCount && upcomingAppt.rows[0]) {
    const ap = upcomingAppt.rows[0]
    blocks.push(`\nUpcoming appointment: ${new Date(ap.scheduled_for).toLocaleString()} (${ap.appointment_type ?? ''})`)
  }

  const resp = await createMessage({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: blocks.join('\n') }],
  })

  const text = resp.content
    .filter(b => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  // Persist to patients.ai_summary cache. Defensive: column added by
  // Wave 17 schema bump. Wrap in try/catch so RDS DBs that haven't been
  // migrated yet still return the AI text — they just won't cache it.
  try {
    await pool.query(
      `UPDATE patients
          SET ai_summary = $1,
              ai_summary_generated_at = NOW(),
              ai_summary_model = $2
        WHERE id = $3 AND practice_id = $4`,
      [text, 'claude-sonnet-4-6', id, ctx.practiceId],
    )
  } catch (err) {
    console.error('[patient-summary] cache write failed:', (err as Error).message)
  }

  await auditEhrAccess({
    ctx,
    action: 'patient.summary.generate',
    resourceType: 'patient',
    resourceId: id,
    details: { kind: 'ai_patient_summary', model: 'claude-sonnet-4-6', cap_used: cap.used + 1 },
  })

  return NextResponse.json({ summary: text, generated_at: new Date().toISOString() })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireEhrApiSession()
  if (ctx instanceof NextResponse) return ctx
  const { id } = await params

  try {
    const { rows } = await pool.query(
      `SELECT ai_summary, ai_summary_generated_at, ai_summary_model
         FROM patients
        WHERE id = $1 AND practice_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [id, ctx.practiceId],
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    await auditEhrAccess({
      ctx,
      action: 'patient.summary.view',
      resourceType: 'patient',
      resourceId: id,
    })
    return NextResponse.json({
      summary: rows[0].ai_summary,
      generated_at: rows[0].ai_summary_generated_at,
      model: rows[0].ai_summary_model,
    })
  } catch (err) {
    // Cache columns may not exist yet — return empty summary so the UI
    // can offer Regenerate without erroring.
    console.error('[patient-summary] cache read failed:', (err as Error).message)
    return NextResponse.json({ summary: null, generated_at: null, model: null })
  }
}

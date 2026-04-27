// app/api/dashboard/ai-brief/route.ts
//
// Wave 36 — Sonnet generates a 90-second morning brief for the therapist.
// Reads today's appointment list + outstanding work + recent activity,
// then writes 4-6 sentences that orient the therapist for the day.
//
// Safe content: factual summary of the practice's state. No clinical
// recommendations. Caller can regenerate ad-hoc; no caching needed at
// the per-day level since the data churns within a session.
//
// Per-practice daily AI cap shared with the rest of the AI features.

import { NextResponse, type NextRequest } from 'next/server'
import { pool } from '@/lib/aws/db'
import { requireApiSession } from '@/lib/aws/api-auth'
import { createMessage } from '@/lib/aws/llm'
import { checkAiRateLimit } from '@/lib/aws/ehr/draft-rate-limit'
import { auditSystemEvent } from '@/lib/aws/ehr/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are briefing a therapist before they start their clinical day. Read the data — today's appointments + outstanding work + last 24h of activity — then write a 4-6 sentence overview in the therapist's voice (second person, warm, professional).

Rules:
  - Stick to FACTS in the data. Don't invent context, don't infer clinical concerns the data doesn't show.
  - Don't tell the therapist what to do clinically; they own the clinical judgment. You can flag work items (notes to sign, crisis alerts that fired) but don't recommend interventions.
  - Lead with the most timely thing — first session of the day OR an active crisis flag.
  - Mention 1-2 specific patient names if it adds clarity (e.g. "Mary at 9 already completed her PHQ-9 yesterday — score 12, mild").
  - End with one quick orientation note about the day's volume or what comes next.
  - 4-6 sentences total. Conversational. No bullet points, no headers.

Don't return markdown. Just plain prose.`

async function loadBriefContext(practiceId: string): Promise<string> {
  const [appts, drafts, crises, recentNotes, recentIntakes] = await Promise.all([
    pool.query(
      `SELECT a.scheduled_for, a.appointment_type, a.duration_minutes,
              p.first_name, p.last_name,
              (SELECT json_build_object('phq9', i.phq9_score, 'gad7', i.gad7_score, 'completed_at', i.completed_at)
                 FROM intake_forms i
                WHERE i.patient_id = a.patient_id AND i.completed_at IS NOT NULL
                ORDER BY i.completed_at DESC LIMIT 1) AS latest_intake
         FROM appointments a
         LEFT JOIN patients p ON p.id = a.patient_id
        WHERE a.practice_id = $1
          AND a.scheduled_for >= date_trunc('day', NOW())
          AND a.scheduled_for <  date_trunc('day', NOW()) + INTERVAL '1 day'
          AND a.status IN ('scheduled', 'confirmed', 'in_progress')
        ORDER BY a.scheduled_for ASC LIMIT 8`,
      [practiceId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS draft_count FROM ehr_progress_notes WHERE practice_id = $1 AND status = 'draft'`,
      [practiceId],
    ),
    pool.query(
      `SELECT severity, summary, created_at,
              (SELECT first_name || ' ' || last_name FROM patients WHERE id = crisis_alerts.patient_id) AS patient_name
         FROM crisis_alerts
        WHERE practice_id = $1 AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC LIMIT 5`,
      [practiceId],
    ),
    pool.query(
      `SELECT signed_at, (SELECT first_name || ' ' || last_name FROM patients WHERE id = ehr_progress_notes.patient_id) AS patient_name
         FROM ehr_progress_notes
        WHERE practice_id = $1 AND signed_at > NOW() - INTERVAL '24 hours'
        ORDER BY signed_at DESC LIMIT 5`,
      [practiceId],
    ),
    pool.query(
      `SELECT completed_at, phq9_score, gad7_score,
              (SELECT first_name || ' ' || last_name FROM patients WHERE id = intake_forms.patient_id) AS patient_name
         FROM intake_forms
        WHERE practice_id = $1 AND completed_at > NOW() - INTERVAL '48 hours'
        ORDER BY completed_at DESC LIMIT 5`,
      [practiceId],
    ),
  ])

  return JSON.stringify({
    today: new Date().toISOString(),
    appointments_today: appts.rows.map(a => ({
      time: new Date(a.scheduled_for).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
      patient: [a.first_name, a.last_name].filter(Boolean).join(' '),
      type: a.appointment_type,
      duration_min: a.duration_minutes,
      latest_intake: a.latest_intake,
    })),
    drafts_pending: drafts.rows[0]?.draft_count ?? 0,
    recent_crisis_flags: crises.rows.map(c => ({
      patient: c.patient_name,
      severity: c.severity,
      summary: c.summary,
      when: c.created_at,
    })),
    notes_signed_last_24h: recentNotes.rows.map(n => n.patient_name),
    intakes_completed_last_48h: recentIntakes.rows.map(i => ({
      patient: i.patient_name,
      phq9: i.phq9_score,
      gad7: i.gad7_score,
    })),
  }, null, 2)
}

export async function GET(_req: NextRequest) {
  const ctx = await requireApiSession()
  if (ctx instanceof NextResponse) return ctx
  const practiceId = ctx.practiceId
  if (!practiceId) return NextResponse.json({ error: 'no_practice' }, { status: 403 })

  const cap = await checkAiRateLimit(practiceId, 'ai.daily_brief.%')
  if (!cap.allowed) {
    return NextResponse.json({ error: 'daily_cap_reached', cap: cap.cap, used: cap.used }, { status: 429 })
  }

  let context: string
  try { context = await loadBriefContext(practiceId) }
  catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 500 }) }

  // Fast-path: if there's literally nothing to say, return a default
  // greeting rather than burning a Sonnet call on it.
  try {
    const ctxJson = JSON.parse(context)
    if (
      (ctxJson.appointments_today?.length || 0) === 0 &&
      (ctxJson.drafts_pending || 0) === 0 &&
      (ctxJson.recent_crisis_flags?.length || 0) === 0 &&
      (ctxJson.intakes_completed_last_48h?.length || 0) === 0
    ) {
      return NextResponse.json({
        brief: 'Quiet morning — no appointments today and no outstanding work. Take a breath. New patients calling in will land in your queue automatically.',
        generated_at: new Date().toISOString(),
        source: 'fast_path',
      })
    }
  } catch {}

  try {
    const resp = await createMessage({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: context }],
    })
    const text = resp.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()

    await auditSystemEvent({
      action: 'ai.daily_brief.generated',
      severity: 'info',
      practiceId,
      details: { length: text.length },
    }).catch(() => {})

    return NextResponse.json({ brief: text, generated_at: new Date().toISOString(), source: 'fresh' })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

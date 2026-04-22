// app/api/ehr/assessments/interpret/route.ts
// Sonnet-powered clinical interpretation of a patient's assessment trend.
// Therapist clicks "Interpret with AI" on the Assessments card; we pull the
// last N completed scores + patient context + active treatment plan + recent
// notes, and ask Claude Sonnet for a short clinical summary the therapist
// can paste into a progress note (after review).

import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'
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
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  const patientId = body?.patient_id
  const instrumentId = body?.assessment_type
  if (!patientId || !instrumentId) {
    return NextResponse.json({ error: 'patient_id and assessment_type required' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Anthropic API not configured' }, { status: 500 })

  const inst = getInstrument(instrumentId)
  if (!inst) return NextResponse.json({ error: 'Unknown instrument' }, { status: 400 })

  const [patient, assessments, plan, recentNotes] = await Promise.all([
    supabaseAdmin.from('patients').select('first_name, last_name, reason_for_seeking').eq('id', patientId).maybeSingle(),
    supabaseAdmin
      .from('patient_assessments')
      .select('score, severity, responses_json, completed_at, alerts_triggered')
      .eq('practice_id', auth.practiceId)
      .eq('patient_id', patientId)
      .eq('assessment_type', inst.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: true })
      .limit(20),
    supabaseAdmin
      .from('ehr_treatment_plans')
      .select('presenting_problem, goals, frequency, start_date')
      .eq('practice_id', auth.practiceId).eq('patient_id', patientId).eq('status', 'active').maybeSingle(),
    supabaseAdmin
      .from('ehr_progress_notes')
      .select('title, assessment, plan, created_at')
      .eq('practice_id', auth.practiceId).eq('patient_id', patientId)
      .in('status', ['signed','amended'])
      .order('created_at', { ascending: false })
      .limit(3),
  ])

  if (!assessments.data || assessments.data.length === 0) {
    return NextResponse.json({ error: 'No completed assessments of this type yet' }, { status: 400 })
  }

  const trend = assessments.data.map((a: any) => ({
    date: a.completed_at ? new Date(a.completed_at).toLocaleDateString() : null,
    score: a.score,
    severity: a.severity,
    alerts: a.alerts_triggered,
  }))

  const latest = assessments.data[assessments.data.length - 1]
  const latestResponses = latest.responses_json
    ? inst.questions.map((q) => ({ item: q.text, score: (latest.responses_json as any)[q.id] ?? null }))
    : null

  const contextBlocks: string[] = []
  contextBlocks.push(`Instrument: ${inst.id} — ${inst.name}`)
  contextBlocks.push(`Max score: ${inst.max_score}`)
  contextBlocks.push(`Severity bands: ${inst.bands.map((b) => `${b.min}-${b.max} ${b.label}`).join('; ')}`)
  if (patient.data) {
    const name = [patient.data.first_name, patient.data.last_name].filter(Boolean).join(' ')
    if (name) contextBlocks.push(`Patient: ${name}`)
    if (patient.data.reason_for_seeking) contextBlocks.push(`Reason for seeking care: ${patient.data.reason_for_seeking}`)
  }
  contextBlocks.push(`\nScore history (chronological):\n${trend.map((t) => `  ${t.date ?? '?'}: ${t.score} (${t.severity ?? ''})${t.alerts && t.alerts.length ? '  ALERT: ' + JSON.stringify(t.alerts) : ''}`).join('\n')}`)
  if (latestResponses) {
    contextBlocks.push(`\nMost recent item-level responses:\n${latestResponses.map((r) => `  [${r.score}] ${r.item}`).join('\n')}`)
  }
  if (plan.data) {
    contextBlocks.push(`\nActive treatment plan:\n  Presenting: ${plan.data.presenting_problem || 'n/a'}\n  Frequency: ${plan.data.frequency || 'n/a'}\n  Goals: ${(plan.data.goals || []).map((g: any) => `- ${g.text}`).join('\n    ')}`)
  }
  if (recentNotes.data && recentNotes.data.length) {
    contextBlocks.push(`\nRecent notes (assessment + plan sections only):\n${recentNotes.data.map((n: any) => `  [${new Date(n.created_at).toLocaleDateString()}] ${n.title}\n    A: ${(n.assessment || '').slice(0, 200)}\n    P: ${(n.plan || '').slice(0, 200)}`).join('\n')}`)
  }

  const client = new Anthropic({ apiKey })
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    temperature: 0.2,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: contextBlocks.join('\n') }],
  })

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  // Persist the interpretation on the most recent completed row so it's
  // visible next to the score in the UI.
  await supabaseAdmin
    .from('patient_assessments')
    .update({ interpretation: text, interpretation_generated_at: new Date().toISOString() })
    .eq('id', latest.id ?? undefined) // latest came from .select() without id; use a separate query
    // Note: our select above didn't include id. Re-fetch latest ID:
  const { data: latestRow } = await supabaseAdmin
    .from('patient_assessments')
    .select('id')
    .eq('practice_id', auth.practiceId).eq('patient_id', patientId).eq('assessment_type', inst.id).eq('status', 'completed')
    .order('completed_at', { ascending: false }).limit(1).maybeSingle()
  if (latestRow?.id) {
    await supabaseAdmin
      .from('patient_assessments')
      .update({ interpretation: text, interpretation_generated_at: new Date().toISOString() })
      .eq('id', latestRow.id)
  }

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.view',
    resourceId: patientId,
    details: { kind: 'assessment_interpret', instrument: inst.id, trend_length: trend.length },
  })

  return NextResponse.json({ interpretation: text, applied_to_id: latestRow?.id })
}

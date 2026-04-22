// app/api/ehr/patients/[id]/summary/route.ts
// Sonnet writes a 3-5 sentence snapshot of the patient from everything
// we know: intake reason, recent calls, latest assessments, last signed
// note's assessment + plan, recent mood trend.
//
// Cached on patients.ai_summary. Therapist clicks "Regenerate" to refresh.

import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

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
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Anthropic API not configured' }, { status: 500 })

  // Load a tight slice of context.
  const [patient, calls, assessments, lastNote, mood, hwOpen, upcomingAppt, safety, recentCrisis] = await Promise.all([
    supabaseAdmin.from('patients').select('first_name, last_name, date_of_birth, reason_for_seeking, insurance, referral_source').eq('id', id).eq('practice_id', auth.practiceId).maybeSingle(),
    supabaseAdmin.from('call_logs').select('summary, created_at, call_type').eq('practice_id', auth.practiceId).eq('patient_id', id).order('created_at', { ascending: false }).limit(3),
    supabaseAdmin.from('patient_assessments').select('assessment_type, score, severity, completed_at, alerts_triggered').eq('practice_id', auth.practiceId).eq('patient_id', id).eq('status', 'completed').order('completed_at', { ascending: true }).limit(10),
    supabaseAdmin.from('ehr_progress_notes').select('title, assessment, plan, created_at').eq('practice_id', auth.practiceId).eq('patient_id', id).in('status', ['signed','amended']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('ehr_mood_logs').select('mood, anxiety, note, logged_at').eq('practice_id', auth.practiceId).eq('patient_id', id).order('logged_at', { ascending: false }).limit(5),
    supabaseAdmin.from('ehr_homework').select('title, due_date').eq('practice_id', auth.practiceId).eq('patient_id', id).eq('status', 'assigned').limit(3),
    supabaseAdmin.from('appointments').select('appointment_date, appointment_time, appointment_type').eq('practice_id', auth.practiceId).eq('patient_id', id).in('status', ['scheduled','confirmed']).gte('appointment_date', new Date().toISOString().slice(0, 10)).order('appointment_date', { ascending: true }).limit(1).maybeSingle(),
    supabaseAdmin.from('ehr_safety_plans').select('status').eq('practice_id', auth.practiceId).eq('patient_id', id).eq('status', 'active').maybeSingle(),
    supabaseAdmin.from('crisis_alerts').select('id, created_at').eq('practice_id', auth.practiceId).eq('patient_id', id).gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()).limit(3),
  ])

  if (!patient.data) return NextResponse.json({ error: 'Patient not found' }, { status: 404 })

  const p = patient.data
  const blocks: string[] = []
  blocks.push(`Patient: ${[p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown'}${p.date_of_birth ? ` (DOB ${p.date_of_birth})` : ''}`)
  if (p.reason_for_seeking) blocks.push(`Reason for seeking care: ${p.reason_for_seeking}`)
  if (p.referral_source) blocks.push(`Referral source: ${p.referral_source}`)
  if (p.insurance) blocks.push(`Insurance: ${p.insurance}`)

  if (safety.data) blocks.push(`SAFETY: An active Stanley-Brown safety plan is on file. Treat as ongoing risk context.`)
  if (recentCrisis.data && recentCrisis.data.length > 0) {
    blocks.push(`CRISIS: ${recentCrisis.data.length} crisis alert(s) logged in the last 7 days.`)
  }

  if (assessments.data && assessments.data.length > 0) {
    const byType = new Map<string, Array<{ score: number; date: string; alerts: any }>>()
    for (const a of assessments.data) {
      const key = a.assessment_type
      if (!byType.has(key)) byType.set(key, [])
      byType.get(key)!.push({ score: a.score, date: a.completed_at ? new Date(a.completed_at).toLocaleDateString() : '', alerts: a.alerts_triggered })
    }
    blocks.push('\nAssessment trajectory:')
    for (const [type, rows] of byType) {
      const first = rows[0]; const last = rows[rows.length - 1]
      const delta = rows.length > 1 ? ` (baseline ${first.score} → latest ${last.score}, Δ${last.score - first.score >= 0 ? '+' : ''}${last.score - first.score})` : ` (${last.score})`
      const hasAlerts = rows.some((r) => Array.isArray(r.alerts) && r.alerts.length > 0)
      blocks.push(`  - ${type}${delta}${hasAlerts ? ' · ALERT present' : ''}`)
    }
  }

  if (mood.data && mood.data.length > 0) {
    const avg = mood.data.reduce((s, m) => s + m.mood, 0) / mood.data.length
    const latest = mood.data[0]
    blocks.push(`\nRecent mood check-ins: avg ${avg.toFixed(1)}/10 (latest ${latest.mood}). ${latest.note ? `Last note: "${latest.note}"` : ''}`)
  }

  if (calls.data && calls.data.length > 0) {
    blocks.push(`\nRecent call contacts:`)
    for (const c of calls.data.slice(0, 2)) {
      if (c.summary) blocks.push(`  - [${c.call_type ?? 'call'}, ${new Date(c.created_at).toLocaleDateString()}] ${c.summary.slice(0, 220)}`)
    }
  }

  if (lastNote.data) {
    blocks.push(`\nMost recent signed note · ${new Date(lastNote.data.created_at).toLocaleDateString()}:`)
    if (lastNote.data.assessment) blocks.push(`  Assessment: ${lastNote.data.assessment.slice(0, 300)}`)
    if (lastNote.data.plan) blocks.push(`  Plan: ${lastNote.data.plan.slice(0, 300)}`)
  }

  if (hwOpen.data && hwOpen.data.length > 0) {
    blocks.push(`\nOpen homework: ${hwOpen.data.map((h) => h.title).join('; ')}`)
  }

  if (upcomingAppt.data) {
    blocks.push(`\nUpcoming appointment: ${upcomingAppt.data.appointment_date} at ${upcomingAppt.data.appointment_time} (${upcomingAppt.data.appointment_type})`)
  }

  const client = new Anthropic({ apiKey })
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    temperature: 0.2,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: blocks.join('\n') }],
  })

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  await supabaseAdmin
    .from('patients')
    .update({
      ai_summary: text,
      ai_summary_generated_at: new Date().toISOString(),
      ai_summary_model: 'claude-sonnet-4-6',
    })
    .eq('id', id)
    .eq('practice_id', auth.practiceId)

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.view',
    resourceId: id, details: { kind: 'ai_patient_summary' },
  })

  return NextResponse.json({ summary: text, generated_at: new Date().toISOString() })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const { data } = await supabaseAdmin
    .from('patients').select('ai_summary, ai_summary_generated_at, ai_summary_model').eq('id', id).eq('practice_id', auth.practiceId).maybeSingle()
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    summary: data.ai_summary,
    generated_at: data.ai_summary_generated_at,
    model: data.ai_summary_model,
  })
}

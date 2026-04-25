// app/api/portal/assessments/[id]/route.ts
// Patient fetches the full instrument (questions + options) for a pending
// assessment and submits responses.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPortalSession } from '@/lib/ehr/portal'
import { getInstrument, scoreAndEvaluate } from '@/lib/ehr/instruments'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params

  const { data: row } = await supabaseAdmin
    .from('patient_assessments').select('*').eq('id', id).maybeSingle()
  if (!row || row.patient_id !== session.patient_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now() && row.status === 'pending') {
    await supabaseAdmin.from('patient_assessments').update({ status: 'expired' }).eq('id', id)
    return NextResponse.json({ error: 'This assessment has expired. Ask your therapist to reassign it.' }, { status: 410 })
  }

  const inst = getInstrument(row.assessment_type)
  if (!inst) return NextResponse.json({ error: 'Unknown instrument' }, { status: 500 })

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => null)
  const answers = body?.answers as Record<string, number> | undefined
  if (!answers || typeof answers !== 'object') {
    return NextResponse.json({ error: 'answers object required' }, { status: 400 })
  }

  const { data: row } = await supabaseAdmin
    .from('patient_assessments').select('*').eq('id', id).maybeSingle()
  if (!row || row.patient_id !== session.patient_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (row.status === 'completed') {
    return NextResponse.json({ error: 'Already completed' }, { status: 409 })
  }

  const inst = getInstrument(row.assessment_type)
  if (!inst) return NextResponse.json({ error: 'Unknown instrument' }, { status: 500 })

  // Validate all questions answered
  for (const q of inst.questions) {
    const v = answers[q.id]
    if (typeof v !== 'number' || !q.options.some((o) => o.value === v)) {
      return NextResponse.json({ error: `Question "${q.text}" not answered.` }, { status: 400 })
    }
  }

  const { score, severity, alerts } = scoreAndEvaluate(inst.id, answers)

  const { data: updated, error } = await supabaseAdmin
    .from('patient_assessments')
    .update({
      status: 'completed',
      score,
      severity: severity.label,
      responses_json: answers,
      alerts_triggered: alerts,
      administered_via: 'portal',
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Suicidal-ideation alerts also go into crisis_alerts so the crisis flow
  // picks them up (if that table is present in this schema).
  if (alerts.some((a) => a.type === 'suicidal_ideation')) {
    try {
      await supabaseAdmin.from('crisis_alerts').insert({
        practice_id: session.practice_id,
        patient_id: session.patient_id,
        phrase: 'PHQ-9 Q9 endorsed',
        transcript_snippet: `Patient self-reported via portal PHQ-9, item 9 score = ${answers.phq9_9}.`,
        alert_status: 'pending_review',
      })
    } catch (err) {
      console.error('[assessments] could not write crisis_alert', err)
    }
  }

  await auditEhrAccess({
    user: { id: '00000000-0000-0000-0000-000000000000', email: `portal:${session.patient_id}` },
    practiceId: session.practice_id,
    action: 'note.update',
    resourceId: id,
    details: { kind: 'assessment_completed', instrument: inst.id, score, severity: severity.label, alerts },
    severity: alerts.length ? 'warn' : 'info',
  })

  return NextResponse.json({
    assessment: updated,
    score,
    severity,
    alerts,
  })
}

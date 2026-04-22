// app/api/ehr/assessments/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  if (!patientId) return NextResponse.json({ error: 'patient_id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('patient_assessments')
    .select('id, assessment_type, score, severity, completed_at, created_at, administered_by, notes')
    .eq('practice_id', auth.practiceId).eq('patient_id', patientId)
    .order('completed_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ assessments: data })
}

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.patient_id || !body?.assessment_type || typeof body?.score !== 'number') {
    return NextResponse.json({ error: 'patient_id, assessment_type, score required' }, { status: 400 })
  }
  const severity = body.severity || inferSeverity(body.assessment_type, body.score)
  const row: any = {
    practice_id: auth.practiceId,
    patient_id: body.patient_id,
    assessment_type: body.assessment_type,
    score: body.score,
    severity,
    administered_by: body.administered_by || 'therapist',
    notes: body.notes ?? null,
    completed_at: body.completed_at || new Date().toISOString(),
  }
  const { data, error } = await supabaseAdmin.from('patient_assessments').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.create',
    resourceId: data.id, details: { kind: 'assessment', type: row.assessment_type, score: row.score, severity },
  })
  return NextResponse.json({ assessment: data }, { status: 201 })
}

function inferSeverity(type: string, score: number): string {
  const t = (type || '').toUpperCase()
  if (t.includes('PHQ-9') || t === 'PHQ9') {
    if (score >= 20) return 'severe'
    if (score >= 15) return 'moderately severe'
    if (score >= 10) return 'moderate'
    if (score >= 5) return 'mild'
    return 'minimal'
  }
  if (t.includes('GAD-7') || t === 'GAD7') {
    if (score >= 15) return 'severe'
    if (score >= 10) return 'moderate'
    if (score >= 5) return 'mild'
    return 'minimal'
  }
  if (t.includes('PHQ-2') || t === 'PHQ2' || t.includes('GAD-2') || t === 'GAD2') {
    return score >= 3 ? 'positive' : 'negative'
  }
  return 'unspecified'
}

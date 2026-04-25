// app/api/ehr/homework/route.ts — therapist list + assign.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  let q = supabaseAdmin
    .from('ehr_homework')
    .select('id, patient_id, note_id, title, description, due_date, status, completed_at, completion_note, created_at')
    .eq('practice_id', auth.practiceId)
    .order('created_at', { ascending: false })
  if (patientId) q = q.eq('patient_id', patientId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ homework: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.patient_id || !body?.title) {
    return NextResponse.json({ error: 'patient_id and title required' }, { status: 400 })
  }
  const { data, error } = await supabaseAdmin
    .from('ehr_homework').insert({
      practice_id: auth.practiceId,
      patient_id: body.patient_id,
      note_id: body.note_id ?? null,
      title: body.title,
      description: body.description ?? null,
      due_date: body.due_date ?? null,
      status: 'assigned',
      created_by: auth.user.id,
    }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.create',
    resourceId: data.id, details: { kind: 'homework', patient_id: body.patient_id, title: body.title },
  })
  return NextResponse.json({ homework: data }, { status: 201 })
}

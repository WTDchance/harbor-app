// app/api/ehr/group-sessions/[id]/route.ts — full session detail with participants.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const { data: session } = await supabaseAdmin
    .from('ehr_group_sessions').select('*').eq('id', id).eq('practice_id', auth.practiceId).maybeSingle()
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: participants } = await supabaseAdmin
    .from('ehr_group_participants')
    .select('id, patient_id, attendance, participation_note, note_id')
    .eq('group_session_id', id).eq('practice_id', auth.practiceId)

  // Patient info
  const patientIds = (participants ?? []).map((p: any) => p.patient_id)
  const { data: patients } = patientIds.length
    ? await supabaseAdmin.from('patients').select('id, first_name, last_name').in('id', patientIds)
    : { data: [] as any[] }
  const patientMap = new Map((patients ?? []).map((p: any) => [p.id, p]))
  const enriched = (participants ?? []).map((p: any) => ({
    ...p,
    patient: patientMap.get(p.patient_id) ?? null,
  }))

  return NextResponse.json({ session, participants: enriched })
}

// Add or update a participant. Body: { patient_id, attendance?, participation_note? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body?.patient_id) return NextResponse.json({ error: 'patient_id required' }, { status: 400 })

  // Verify session and patient belong to this practice
  const [{ data: session }, { data: patient }] = await Promise.all([
    supabaseAdmin.from('ehr_group_sessions').select('id').eq('id', id).eq('practice_id', auth.practiceId).maybeSingle(),
    supabaseAdmin.from('patients').select('id').eq('id', body.patient_id).eq('practice_id', auth.practiceId).maybeSingle(),
  ])
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!patient) return NextResponse.json({ error: 'Patient not in this practice' }, { status: 404 })

  // Upsert on (group_session_id, patient_id)
  const { data, error } = await supabaseAdmin
    .from('ehr_group_participants')
    .upsert({
      group_session_id: id,
      practice_id: auth.practiceId,
      patient_id: body.patient_id,
      attendance: body.attendance ?? 'attended',
      participation_note: body.participation_note ?? null,
    }, { onConflict: 'group_session_id,patient_id' })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.update',
    resourceId: id, details: { kind: 'group_participant_set', patient_id: body.patient_id, attendance: data.attendance },
  })
  return NextResponse.json({ participant: data })
}

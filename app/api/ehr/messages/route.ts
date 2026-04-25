// app/api/ehr/messages/route.ts — therapist list threads + send to patient.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')
  let q = supabaseAdmin
    .from('ehr_message_threads')
    .select('id, patient_id, subject, last_message_at, last_message_preview, unread_by_practice_count, created_at')
    .eq('practice_id', auth.practiceId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100)
  if (patientId) q = q.eq('patient_id', patientId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ threads: data ?? [] })
}

// Create a new thread OR send a message to an existing thread.
// Body: { patient_id, subject?, body, thread_id? }
export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.patient_id || !body?.body) {
    return NextResponse.json({ error: 'patient_id and body required' }, { status: 400 })
  }

  let threadId = body.thread_id
  if (!threadId) {
    const { data: thread, error } = await supabaseAdmin
      .from('ehr_message_threads').insert({
        practice_id: auth.practiceId,
        patient_id: body.patient_id,
        subject: body.subject || 'New conversation',
      }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    threadId = thread.id
  }

  const { data: msg, error: msgErr } = await supabaseAdmin
    .from('ehr_messages').insert({
      thread_id: threadId,
      practice_id: auth.practiceId,
      patient_id: body.patient_id,
      sender_type: 'practice',
      sender_user_id: auth.user.id,
      body: body.body,
    }).select().single()
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 })

  await supabaseAdmin
    .from('ehr_message_threads')
    .update({
      last_message_at: msg.created_at,
      last_message_preview: body.body.slice(0, 140),
      unread_by_patient_count: 1,
    })
    .eq('id', threadId)

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.create',
    resourceId: threadId, details: { kind: 'message_to_patient', thread_id: threadId },
  })

  return NextResponse.json({ thread_id: threadId, message: msg }, { status: 201 })
}

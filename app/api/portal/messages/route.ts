// app/api/portal/messages/route.ts — patient list + create thread / reply.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPortalSession } from '@/lib/ehr/portal'

export async function GET() {
  const s = await getPortalSession(); if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { data, error } = await supabaseAdmin
    .from('ehr_message_threads')
    .select('id, subject, last_message_at, last_message_preview, unread_by_patient_count, created_at')
    .eq('practice_id', s.practice_id).eq('patient_id', s.patient_id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ threads: data ?? [] })
}

export async function POST(req: NextRequest) {
  const s = await getPortalSession(); if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body?.body) return NextResponse.json({ error: 'body required' }, { status: 400 })

  let threadId = body.thread_id
  if (!threadId) {
    const { data: thread, error } = await supabaseAdmin
      .from('ehr_message_threads').insert({
        practice_id: s.practice_id,
        patient_id: s.patient_id,
        subject: body.subject || 'Question from ' + s.patient_first_name,
      }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    threadId = thread.id
  } else {
    // Verify ownership
    const { data: t } = await supabaseAdmin.from('ehr_message_threads').select('patient_id').eq('id', threadId).maybeSingle()
    if (!t || t.patient_id !== s.patient_id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: msg, error: msgErr } = await supabaseAdmin
    .from('ehr_messages').insert({
      thread_id: threadId,
      practice_id: s.practice_id,
      patient_id: s.patient_id,
      sender_type: 'patient',
      body: body.body,
    }).select().single()
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 })

  // Bump unread for practice side + last message preview
  await supabaseAdmin
    .from('ehr_message_threads')
    .update({
      last_message_at: msg.created_at,
      last_message_preview: body.body.slice(0, 140),
      unread_by_practice_count: 1,
    })
    .eq('id', threadId)

  return NextResponse.json({ thread_id: threadId, message: msg }, { status: 201 })
}

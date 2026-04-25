// app/api/portal/messages/[id]/route.ts — patient reads a thread.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPortalSession } from '@/lib/ehr/portal'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getPortalSession(); if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const { data: thread } = await supabaseAdmin
    .from('ehr_message_threads').select('*').eq('id', id).maybeSingle()
  if (!thread || thread.patient_id !== s.patient_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: messages } = await supabaseAdmin
    .from('ehr_messages').select('id, sender_type, body, created_at, read_at')
    .eq('thread_id', id).order('created_at', { ascending: true })

  if (thread.unread_by_patient_count > 0) {
    await supabaseAdmin.from('ehr_message_threads')
      .update({ unread_by_patient_count: 0 }).eq('id', id)
    await supabaseAdmin.from('ehr_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('thread_id', id).eq('sender_type', 'practice').is('read_at', null)
  }

  return NextResponse.json({ thread, messages: messages ?? [] })
}

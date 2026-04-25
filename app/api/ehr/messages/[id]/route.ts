// app/api/ehr/messages/[id]/route.ts — therapist reads a thread + marks read.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const { data: thread } = await supabaseAdmin
    .from('ehr_message_threads').select('*').eq('id', id).eq('practice_id', auth.practiceId).maybeSingle()
  if (!thread) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: messages } = await supabaseAdmin
    .from('ehr_messages').select('id, sender_type, body, created_at, read_at')
    .eq('thread_id', id).order('created_at', { ascending: true })

  // Mark patient messages as read by practice
  if (thread.unread_by_practice_count > 0) {
    await supabaseAdmin.from('ehr_message_threads')
      .update({ unread_by_practice_count: 0 }).eq('id', id)
    await supabaseAdmin.from('ehr_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('thread_id', id).eq('sender_type', 'patient').is('read_at', null)
  }

  return NextResponse.json({ thread, messages: messages ?? [] })
}

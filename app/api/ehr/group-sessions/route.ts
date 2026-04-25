// app/api/ehr/group-sessions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function GET() {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { data, error } = await supabaseAdmin
    .from('ehr_group_sessions')
    .select('id, title, group_type, scheduled_at, appointment_id, facilitator_id, created_at')
    .eq('practice_id', auth.practiceId)
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sessions: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const body = await req.json().catch(() => null)
  if (!body?.title) return NextResponse.json({ error: 'title required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('ehr_group_sessions')
    .insert({
      practice_id: auth.practiceId,
      title: body.title,
      group_type: body.group_type ?? null,
      facilitator_id: body.facilitator_id ?? null,
      scheduled_at: body.scheduled_at ?? null,
      appointment_id: body.appointment_id ?? null,
    })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.create',
    resourceId: data.id, details: { kind: 'group_session', title: data.title },
  })
  return NextResponse.json({ session: data }, { status: 201 })
}

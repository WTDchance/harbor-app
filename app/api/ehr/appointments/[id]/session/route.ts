// app/api/ehr/appointments/[id]/session/route.ts
// Start / stop / read the actual-session timer on an appointment.
// Does NOT touch the scheduled times — stamps actual_started_at /
// actual_ended_at separately so you can compare plan vs. reality.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('id, actual_started_at, actual_ended_at')
    .eq('id', id).eq('practice_id', auth.practiceId).maybeSingle()
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({
    started_at: data.actual_started_at,
    ended_at: data.actual_ended_at,
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body?.action

  const now = new Date().toISOString()
  const patch: any = {}
  if (action === 'start') {
    patch.actual_started_at = now
    patch.actual_ended_at = null
  } else if (action === 'stop') {
    patch.actual_ended_at = now
  } else if (action === 'reset') {
    patch.actual_started_at = null
    patch.actual_ended_at = null
  } else {
    return NextResponse.json({ error: 'action must be start | stop | reset' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('appointments').update(patch).eq('id', id).eq('practice_id', auth.practiceId)
    .select('id, actual_started_at, actual_ended_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    started_at: data.actual_started_at,
    ended_at: data.actual_ended_at,
  })
}

// FILE: app/api/admin/calendar-diag/route.ts
// Launch-prep diagnostic: returns the current calendar connection + recent
// appointments for a given practice so we can verify that (a) OAuth tokens
// are stored and (b) new appointments are pushing to Google Calendar.
//
// Auth: CRON_SECRET Bearer.
// Usage: GET /api/admin/calendar-diag?practice_id=<uuid>&days=7

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const practiceId = req.nextUrl.searchParams.get('practice_id')
  const days = Number(req.nextUrl.searchParams.get('days') || '7')
  const listAll = req.nextUrl.searchParams.get('all') === 'true'

  // Mode: list every calendar_connection with the practice it belongs to —
  // useful when tokens landed on the wrong practice.
  if (listAll) {
    const { data: connections } = await supabaseAdmin
      .from('calendar_connections')
      .select('id, practice_id, provider, label, connected_email, sync_enabled, token_expires_at, created_at')
      .order('created_at', { ascending: false })

    const ids = (connections || []).map((c) => c.practice_id).filter(Boolean)
    const { data: practices } = await supabaseAdmin
      .from('practices')
      .select('id, name, notification_email, phone_number, vapi_assistant_id, vapi_phone_number_id')
      .in('id', ids)

    const byId = new Map((practices || []).map((p) => [p.id, p]))
    return NextResponse.json({
      total: connections?.length || 0,
      connections: (connections || []).map((c) => ({
        ...c,
        practice: byId.get(c.practice_id) || null,
      })),
    })
  }

  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required (or pass all=true)' }, { status: 400 })
  }

  // 1. Calendar connection
  const { data: conn } = await supabaseAdmin
    .from('calendar_connections')
    .select('id, provider, label, connected_email, sync_enabled, token_expires_at, created_at, updated_at, last_synced_at')
    .eq('practice_id', practiceId)
    .maybeSingle()

  const connection = conn
    ? {
        ...conn,
        has_access_token: null as boolean | null, // filled below
        has_refresh_token: null as boolean | null,
        is_expired: null as boolean | null,
      }
    : null

  if (conn) {
    const { data: tokenPeek } = await supabaseAdmin
      .from('calendar_connections')
      .select('access_token, refresh_token, token_expires_at')
      .eq('id', conn.id)
      .single()
    if (tokenPeek && connection) {
      connection.has_access_token = !!tokenPeek.access_token
      connection.has_refresh_token = !!tokenPeek.refresh_token
      connection.is_expired = tokenPeek.token_expires_at
        ? new Date(tokenPeek.token_expires_at).getTime() < Date.now()
        : null
    }
  }

  // 2. Recent + upcoming appointments (+/- days window)
  const now = new Date()
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  const startDate = start.toISOString().split('T')[0]
  const endDate = end.toISOString().split('T')[0]

  const { data: appts } = await supabaseAdmin
    .from('appointments')
    .select('id, patient_name, patient_phone, patient_email, appointment_date, appointment_time, scheduled_at, status, source, calendar_event_id, created_at')
    .eq('practice_id', practiceId)
    .gte('appointment_date', startDate)
    .lte('appointment_date', endDate)
    .order('appointment_date', { ascending: true })
    .order('appointment_time', { ascending: true })

  const appointments = (appts || []).map((a: any) => ({
    ...a,
    synced_to_calendar: !!a.calendar_event_id,
  }))

  // 3. Quick summary
  const summary = {
    has_connection: !!conn,
    provider: conn?.provider || null,
    total_appointments_in_window: appointments.length,
    synced_to_calendar: appointments.filter((a) => a.synced_to_calendar).length,
    not_synced: appointments.filter((a) => !a.synced_to_calendar).length,
    window: { start: startDate, end: endDate },
  }

  return NextResponse.json({ practice_id: practiceId, connection, appointments, summary })
}

// DELETE /api/admin/calendar-diag?practice_id=...&provider=google
// Removes a calendar_connections row. Used to clean up tokens that landed
// on the wrong practice so the user can redo the OAuth flow.
export async function DELETE(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const practiceId = req.nextUrl.searchParams.get('practice_id')
  const provider = req.nextUrl.searchParams.get('provider') || 'google'
  if (!practiceId) {
    return NextResponse.json({ error: 'practice_id required' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('calendar_connections')
    .delete()
    .eq('practice_id', practiceId)
    .eq('provider', provider)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, practice_id: practiceId, provider })
}

// POST /api/admin/calendar-diag   — move a calendar_connections row to a
// different practice_id. Preserves the OAuth tokens so the user does NOT
// have to reconnect.
//
// body: { from_practice_id: string, to_practice_id: string, provider?: string }
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) return unauthorized()

  const body = await req.json().catch(() => ({}))
  const fromId = body.from_practice_id as string | undefined
  const toId = body.to_practice_id as string | undefined
  const provider = (body.provider as string | undefined) || 'google'
  if (!fromId || !toId) {
    return NextResponse.json({ error: 'from_practice_id and to_practice_id required' }, { status: 400 })
  }

  // Remove any existing connection on the destination to avoid unique conflicts
  await supabaseAdmin
    .from('calendar_connections')
    .delete()
    .eq('practice_id', toId)
    .eq('provider', provider)

  const { data, error } = await supabaseAdmin
    .from('calendar_connections')
    .update({ practice_id: toId, updated_at: new Date().toISOString() })
    .eq('practice_id', fromId)
    .eq('provider', provider)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || 'no row found' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, moved_to: toId, provider, id: data.id })
}

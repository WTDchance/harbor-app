// app/api/integrations/google-calendar/route.ts
// Harbor - Google Calendar connection status + disconnect.
//
// GET    returns { connected, email, calendar_id } for the active practice.
// DELETE tears down the connection.
//
// Source of truth: the calendar_connections table (provider='google'). The legacy
// practices.google_calendar_* columns existed in an earlier version of the app
// and were never migrated off; the OAuth callback route writes to calendar_connections,
// so reading the legacy columns here gave a false 'not connected' even when the
// tokens were stored. This route now reads and writes the new table, and also
// nulls the legacy columns on disconnect so nothing can re-surface stale values.

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getEffectivePracticeId } from '@/lib/active-practice'

async function getUserAndPractice() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (s) => {
          try {
            s.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, practiceId: null }
  const practiceId = await getEffectivePracticeId(supabase, user)
  return { user, practiceId }
}

export async function GET(_req: NextRequest) {
  try {
    const { user, practiceId } = await getUserAndPractice()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!practiceId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // New path: calendar_connections. A row here with a non-null access_token
    // means the OAuth dance completed and we can act on the calendar.
    const { data: connection } = await supabaseAdmin
      .from('calendar_connections')
      .select('id, connected_email, access_token, refresh_token, token_expires_at, sync_enabled, created_at')
      .eq('practice_id', practiceId)
      .eq('provider', 'google')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (connection && connection.access_token) {
      return NextResponse.json({
        connected: true,
        email: connection.connected_email || null,
        calendar_id: 'primary',
      })
    }

    // Legacy fallback: practices.google_calendar_* columns. Some older accounts
    // may still hold tokens here. Report connected so they can reconnect or
    // disconnect cleanly instead of being stuck in a 'not connected' state.
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('google_calendar_email, google_calendar_token, google_calendar_id')
      .eq('id', practiceId)
      .maybeSingle()

    const legacyConnected = !!(practice?.google_calendar_token && practice?.google_calendar_email)
    return NextResponse.json({
      connected: legacyConnected,
      email: practice?.google_calendar_email || null,
      calendar_id: practice?.google_calendar_id || 'primary',
    })
  } catch (error: any) {
    console.error('[google-calendar GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest) {
  try {
    const { user, practiceId } = await getUserAndPractice()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!practiceId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Remove any calendar_connections rows for this practice's Google provider.
    // Using delete rather than a soft flag because reconnecting will create a
    // fresh row with new tokens anyway.
    await supabaseAdmin
      .from('calendar_connections')
      .delete()
      .eq('practice_id', practiceId)
      .eq('provider', 'google')

    // Also clear legacy columns so a future GET doesn't report a zombie connection.
    await supabaseAdmin
      .from('practices')
      .update({
        google_calendar_token: null,
        google_calendar_email: null,
      })
      .eq('id', practiceId)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[google-calendar DELETE]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

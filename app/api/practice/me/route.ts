// app/api/practice/me/route.ts
// Returns the effective practice for the current user.
//
// This is THE canonical way for client-side pages to resolve which practice
// they should display. It respects the admin act-as cookie so the admin can
// view any practice's dashboard without data leaking across practices.
//
// All dashboard pages MUST call this instead of directly querying
// users.practice_id from the browser Supabase client.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { getEffectivePracticeId } from '@/lib/active-practice'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const practiceId = await getEffectivePracticeId(supabase, user)
    if (!practiceId) {
      return NextResponse.json({ error: 'No practice found' }, { status: 404 })
    }

    // Use supabaseAdmin (service role) to bypass RLS — the act-as cookie
    // may point to a practice the user doesn't own per RLS policies.
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('*')
      .eq('id', practiceId)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    }

    return NextResponse.json({ practice })
  } catch (err) {
    console.error('[practice/me] error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * PATCH /api/practice/me
 *
 * Accepts a whitelisted subset of practice settings the therapist can
 * toggle from their own dashboard. Keep this strict — anything here is
 * self-serve. Admin-only knobs stay in /api/admin/*.
 */
const SELF_SERVE_FIELDS = ['is_crisis_capable'] as const

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const practiceId = await getEffectivePracticeId(supabase, user)
    if (!practiceId) return NextResponse.json({ error: 'No practice found' }, { status: 404 })

    let body: any
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    for (const f of SELF_SERVE_FIELDS) {
      if (f in body) {
        const v = body[f]
        if (typeof v === 'boolean') updates[f] = v
      }
    }
    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('practices')
      .update(updates)
      .eq('id', practiceId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[practice/me PATCH] error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

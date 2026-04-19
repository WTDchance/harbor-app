// app/api/practice/me/route.ts
// Returns the effective practice for the current user.
//
// This is THE canonical way for client-side pages to resolve which practice
// they should display. It respects the admin act-as cookie so the admin can
// view any practice's dashboard without data leaking across practices.
//
// All dashboard pages MUST call this instead of directly querying
// users.practice_id from the browser Supabase client.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
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

    const { data: practice } = await supabase
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

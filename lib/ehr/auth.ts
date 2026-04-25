// lib/ehr/auth.ts
// Harbor EHR — shared API auth helper.
//
// Pattern B from docs/ehr-branch-setup.md §6: server-component cookies +
// act-as practice resolution. Returns the authenticated user, the effective
// practice_id, and rejects early if EHR isn't enabled for that practice.

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { isEhrEnabled } from '@/lib/ehr/feature-flag'

export type EhrAuth = {
  user: User
  practiceId: string
  supabase: SupabaseClient
}

async function makeServerClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }: any) => {
              cookieStore.set(name, value, options)
            })
          } catch {}
        },
      },
    },
  )
}

/**
 * For API routes. Returns { user, practiceId, supabase } when the caller is
 * authenticated AND EHR is enabled for their practice. Returns a ready-made
 * NextResponse error otherwise — the caller should just `return` it.
 */
export async function requireEhrAuth(): Promise<EhrAuth | NextResponse> {
  const supabase = await makeServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const practiceId = await getEffectivePracticeId(supabaseAdmin, user)
  if (!practiceId) {
    return NextResponse.json({ error: 'No practice' }, { status: 403 })
  }

  const enabled = await isEhrEnabled(supabaseAdmin, practiceId)
  if (!enabled) {
    return NextResponse.json(
      { error: 'EHR not enabled for this practice' },
      { status: 403 },
    )
  }

  return { user, practiceId, supabase }
}

export function isAuthError(x: EhrAuth | NextResponse): x is NextResponse {
  return x instanceof NextResponse
}

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getEffectivePracticeId } from '@/lib/active-practice'

async function getAuthenticatedPracticeId() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (s) => {
          try {
            s.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {}
        }
      }
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Effective practice (admin may override via act-as cookie)
  const effective = await getEffectivePracticeId(supabaseAdmin, user)
  if (effective) return effective

  // Fallback: try practices table by email (appointments pattern)
  const { data: practice } = await supabaseAdmin
    .from('practices')
    .select('id')
    .eq('notification_email', user.email)
    .single()

  return practice?.id || null
}

export async function GET(req: NextRequest) {
  try {
    const practiceId = await getAuthenticatedPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const mode = searchParams.get('mode') || 'full'
    const limit = parseInt(searchParams.get('limit') || '100')

    if (mode === 'stats') {
      // Dashboard home stats mode
      // Use client-provided date range (browser local time) or fall back to server UTC
      const from = searchParams.get('from')
      const to = searchParams.get('to')
      let startOfDay: string
      let endOfDay: string
      if (from && to) {
        startOfDay = from
        endOfDay = to
      } else {
        const now = new Date()
        startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
        endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
      }

      const [todayResult, recentResult, crisisResult, totalResult] = await Promise.all([
        supabaseAdmin
          .from('call_logs')
          .select('id', { count: 'exact', head: true })
          .eq('practice_id', practiceId)
          .gte('created_at', startOfDay)
          .lte('created_at', endOfDay),
        supabaseAdmin
          .from('call_logs')
          .select('id, patient_phone, duration_seconds, summary, created_at, crisis_detected')
          .eq('practice_id', practiceId)
          .order('created_at', { ascending: false })
          .limit(5),
        supabaseAdmin
          .from('call_logs')
          .select('id', { count: 'exact', head: true })
          .eq('practice_id', practiceId)
          .eq('crisis_detected', true),
        supabaseAdmin
          .from('call_logs')
          .select('id', { count: 'exact', head: true })
          .eq('practice_id', practiceId),
      ])

      return NextResponse.json({
        todayCount: todayResult.count || 0,
        totalCount: totalResult.count || 0,
        recentCalls: recentResult.data || [],
        crisisCount: crisisResult.count || 0,
      })
    }

    // Full call list mode (for calls page)
    let query = supabaseAdmin
      .from('call_logs')
      .select('id, patient_phone, duration_seconds, summary, transcript, created_at, crisis_detected, caller_name, call_type, insurance_mentioned, session_type, preferred_times, reason_for_calling, patient_id')
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })
      .limit(limit)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ calls: data || [] })
  } catch (e: any) {
    console.error('[Dashboard Calls API] Error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

async function getPractice() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (s) => { try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('practices').select('id, name').eq('notification_email', user.email).single()
  return data
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Verify crisis alert belongs to user's practice
    const { data: crisisAlert } = await supabaseAdmin
      .from('crisis_alerts')
      .select('practice_id')
      .eq('id', params.id)
      .single()

    if (!crisisAlert || crisisAlert.practice_id !== practice.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error } = await supabaseAdmin
      .from('crisis_alerts')
      .update({ reviewed: true, reviewed_at: new Date().toISOString() })
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error marking crisis alert as reviewed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

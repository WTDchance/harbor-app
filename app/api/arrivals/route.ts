import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (n) => cookieStore.get(n)?.value } }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('id')
      .eq('notification_email', user.email)
      .single()

    if (!practice) return NextResponse.json({ arrivals: [] })

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { data: arrivals } = await supabaseAdmin
      .from('patient_arrivals')
      .select('*')
      .eq('practice_id', practice.id)
      .gte('arrived_at', today.toISOString())
      .order('arrived_at', { ascending: false })

    return NextResponse.json({ arrivals: arrivals || [] })
  } catch (error) {
    console.error('Error fetching arrivals:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

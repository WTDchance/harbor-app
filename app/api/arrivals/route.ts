import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireApiSession } from '@/lib/aws/api-auth'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies()
    // supabase client removed (Cognito auth)
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
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

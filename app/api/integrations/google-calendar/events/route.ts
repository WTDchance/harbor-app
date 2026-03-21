import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getCalendarEvents } from '@/lib/googleCalendar'

export async function GET(req: NextRequest) {
    try {
          const cookieStore = await cookies()
          const supabase = createServerClient(
                  process.env.NEXT_PUBLIC_SUPABASE_URL!,
                  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                  {
                            cookies: {
                                        getAll: () => cookieStore.getAll(),
                                        setAll: (s) => { try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} }
                                      }
                          }
                )
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

          const { data: practice } = await supabaseAdmin
            .from('practices')
            .select('id, google_calendar_id')
            .eq('notification_email', user.email)
            .single()

          if (!practice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

          const { searchParams } = new URL(req.url)
          const timeMin = searchParams.get('timeMin') || new Date().toISOString()
          const timeMax = searchParams.get('timeMax') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

          const events = await getCalendarEvents(
                  practice.id,
                  practice.google_calendar_id || 'primary',
                  timeMin,
                  timeMax
                )

          return NextResponse.json({ events })
        } catch (error: any) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
  }

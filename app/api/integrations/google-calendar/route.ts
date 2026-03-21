import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

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

          const { data: practice } = await supabase
            .from('practices')
            .select('id, google_calendar_email, google_calendar_token, google_calendar_id')
            .eq('notification_email', user.email)
            .single()

          if (!practice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

          const isConnected = !!(practice.google_calendar_token && practice.google_calendar_email)
          return NextResponse.json({
                  connected: isConnected,
                  email: practice.google_calendar_email || null,
                  calendar_id: practice.google_calendar_id || 'primary',
                })
        } catch (error: any) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
  }

export async function DELETE(req: NextRequest) {
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

          const { data: practice } = await supabase.from('practices').select('id').eq('notification_email', user.email).single()
          if (!practice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

          await supabaseAdmin.from('practices').update({
                  google_calendar_token: null,
                  google_calendar_email: null,
                }).eq('id', practice.id)

          return NextResponse.json({ success: true })
        } catch (error: any) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
  }

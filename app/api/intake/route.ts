import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { randomBytes } from 'crypto'

export async function GET(req: NextRequest) {
    try {
          const cookieStore = await cookies()
          const supabase = createServerClient(
                  process.env.NEXT_PUBLIC_SUPABASE_URL!,
                  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                  { cookies: { getAll: () => cookieStore.getAll(), setAll: (s) => { try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } }
                )
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

          const { data: practice } = await supabase.from('practices').select('id').eq('notification_email', user.email).single()
          if (!practice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

          const { data: submissions } = await supabaseAdmin
            .from('intake_submissions')
            .select('*')
            .eq('practice_id', practice.id)
            .order('created_at', { ascending: false })

          return NextResponse.json({ submissions: submissions || [] })
        } catch (error: any) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
  }

export async function POST(req: NextRequest) {
    try {
          const cookieStore = await cookies()
          const supabase = createServerClient(
                  process.env.NEXT_PUBLIC_SUPABASE_URL!,
                  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                  { cookies: { getAll: () => cookieStore.getAll(), setAll: (s) => { try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } }
                )
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

          const { data: practice } = await supabase.from('practices').select('id').eq('notification_email', user.email).single()
          if (!practice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

          const { patient_name, patient_phone } = await req.json()
          const token = randomBytes(24).toString('hex')

          const { data: submission, error } = await supabaseAdmin
            .from('intake_submissions')
            .insert({ practice_id: practice.id, token, patient_name, patient_phone, status: 'pending' })
            .select()
            .single()

          if (error) throw error

          const intakeUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://your-app.railway.app'}/intake/${token}`

          return NextResponse.json({ submission, intake_url: intakeUrl })
        } catch (error: any) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
  }

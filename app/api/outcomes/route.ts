import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { randomBytes } from 'crypto'

async function getPractice() {
    const cookieStore = await cookies()
    const supabase = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { cookies: { getAll: () => cookieStore.getAll(), setAll: (s) => { try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } }
        )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase.from('practices').select('id').eq('notification_email', user.email).single()
    return data
  }

export async function GET(req: NextRequest) {
    try {
          const practice = await getPractice()
          if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

          const { searchParams } = new URL(req.url)
          const phone = searchParams.get('phone')

          let query = supabaseAdmin
            .from('outcome_assessments')
            .select('*')
            .eq('practice_id', practice.id)
            .order('created_at', { ascending: false })

          if (phone) query = query.eq('patient_phone', phone)

          const { data } = await query
          return NextResponse.json({ assessments: data || [] })
        } catch (e: any) {
          return NextResponse.json({ error: e.message }, { status: 500 })
        }
  }

export async function POST(req: NextRequest) {
    try {
          const practice = await getPractice()
          if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

          const { patient_name, patient_phone, assessment_type } = await req.json()
          const token = randomBytes(24).toString('hex')

          const { data, error } = await supabaseAdmin
            .from('outcome_assessments')
            .insert({ practice_id: practice.id, patient_name, patient_phone, assessment_type, token })
            .select()
            .single()

          if (error) throw error

          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://your-app.railway.app'
          const assessmentUrl = `${appUrl}/outcomes/${token}`

          return NextResponse.json({ assessment: data, assessment_url: assessmentUrl })
        } catch (e: any) {
          return NextResponse.json({ error: e.message }, { status: 500 })
        }
  }

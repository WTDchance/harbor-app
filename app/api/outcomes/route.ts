import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { randomBytes } from 'crypto'
import { requireApiSession } from '@/lib/aws/api-auth'

async function getPractice() {
    // supabase client removed (Cognito auth)
    const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return null
    const { data } = await supabaseAdmin.from('practices').select('id').eq('notification_email', user.email).single()
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

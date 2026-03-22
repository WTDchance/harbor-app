import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

async function getPractice() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (s) => {
          try { s.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        }
      }
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('practices').select('id, name').eq('notification_email', user.email).single()
  return data
}

export async function GET(req: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const week = searchParams.get('week')
    const start = searchParams.get('start')
    const end = searchParams.get('end')
    const today = new Date().toISOString().split('T')[0]

    let query = supabaseAdmin.from('appointments').select('*').eq('practice_id', practice.id).order('appointment_date').order('appointment_time')

    if (start && end) {
      query = query.gte('appointment_date', start).lte('appointment_date', end)
    } else if (week) {
      const endDate = new Date(week + 'T00:00:00Z')
      endDate.setDate(endDate.getDate() + 6)
      query = query.gte('appointment_date', week).lte('appointment_date', endDate.toISOString().split('T')[0])
    } else {
      const future = new Date()
      future.setDate(future.getDate() + 30)
      query = query.gte('appointment_date', today).lte('appointment_date', future.toISOString().split('T')[0])
    }

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ appointments: data || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await req.json()
    const { data, error } = await supabaseAdmin.from('appointments').insert({
      practice_id: practice.id,
      source: 'manual',
      ...body
    }).select().single()
    if (error) throw error
    return NextResponse.json({ appointment: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id, ...updates } = await req.json()
    const { data, error } = await supabaseAdmin.from('appointments').update({
      ...updates,
      updated_at: new Date().toISOString()
    }).eq('id', id).eq('practice_id', practice.id).select().single()
    if (error) throw error
    return NextResponse.json({ appointment: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    await supabaseAdmin.from('appointments').delete().eq('id', searchParams.get('id')!).eq('practice_id', practice.id)
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

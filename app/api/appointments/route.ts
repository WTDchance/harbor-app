// FILE: app/api/appointments/route.ts
// FIXES:
//   1. getPractice() now queries users table for practice_id (like every other route)
//      instead of fragile notification_email match on practices table
//   2. Cancellation fill baseUrl uses NEXT_PUBLIC_APP_URL (not NEXT_PUBLIC_SITE_URL/VERCEL_URL)

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getEffectivePracticeId } from '@/lib/active-practice'

async function getPractice() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }: any) => {
              cookieStore.set(name, value, options)
            })
          } catch {}
        }
      }
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const practiceId = await getEffectivePracticeId(supabaseAdmin, user)
  if (!practiceId) return null

  const { data: practice } = await supabaseAdmin
    .from('practices')
    .select('id, name')
    .eq('id', practiceId)
    .single()

  return practice
}

export async function GET(req: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const week = searchParams.get('week')
    const start = searchParams.get('start')
    const end = searchParams.get('end')
    const today = new Date().toISOString().split('T')[0]

    let query = supabaseAdmin
      .from('appointments')
      .select('*')
      .eq('practice_id', practice.id)
      .order('appointment_date')
      .order('appointment_time')

    if (start && end) {
      query = query.gte('appointment_date', start).lte('appointment_date', end)
    } else if (week) {
      const endDate = new Date(week + 'T00:00:00Z')
      endDate.setDate(endDate.getDate() + 7)
      query = query.gte('appointment_date', week).lte('appointment_date', endDate.toISOString().split('T')[0])
    } else {
      const future = new Date()
      future.setDate(future.getDate() + 7)
      query = query.gte('appointment_date', today).lte('appointment_date', future.toISOString().split('T')[0])
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ appointments: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { data, error } = await supabaseAdmin
      .from('appointments')
      .insert({
        practice_id: practice.id,
        source: 'manual',
        ...body,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ appointment: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, ...updates } = await req.json()

    const { data: existing } = await supabaseAdmin
      .from('appointments')
      .select('status, appointment_date, appointment_time, duration_minutes, patient_id')
      .eq('id', id)
      .eq('practice_id', practice.id)
      .single()

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('practice_id', practice.id)
      .select()
      .single()

    if (error) throw error

    if (
      updates.status === 'cancelled' &&
      existing?.status !== 'cancelled' &&
      existing?.appointment_date &&
      existing?.appointment_time
    ) {
      try {
        const slotTime = new Date(`${existing.appointment_date}T${existing.appointment_time}`)
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'

        await fetch(`${baseUrl}/api/cancellation/fill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            practice_id: practice.id,
            slot_time: slotTime.toISOString(),
            was_telehealth: false,
          }),
        })
      } catch (fillErr) {
        console.error('Auto-fill trigger failed (non-blocking):', fillErr)
      }
    }

    return NextResponse.json({ appointment: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const practice = await getPractice()
    if (!practice) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    await supabaseAdmin
      .from('appointments')
      .delete()
      .eq('id', searchParams.get('id')!)
      .eq('practice_id', practice.id)

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// Schedule Changes API
// GET  — list recent changes for the practice
// POST — create a new schedule change (from Ellie or dashboard)

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase-server'

async function getPracticeId(): Promise<string | null> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabaseAdmin.from('users').select('practice_id').eq('id', user.id).single()
  return data?.practice_id || null
}

export async function GET(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const status = searchParams.get('status') // pending, confirmed, reverted, auto_confirmed

    let query = supabaseAdmin
      .from('schedule_changes')
      .select(`
        *,
        patients(first_name, last_name, phone),
        appointments(scheduled_at, duration_minutes, status)
      `)
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query

    if (error) {
      console.error('[schedule-changes GET]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ changes: data })
  } catch (err) {
    console.error('[schedule-changes GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const practiceId = await getPracticeId()
    if (!practiceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      appointment_id,
      patient_id,
      change_type,
      previous_time,
      new_time,
      requested_by,
      dob_verified,
      notes,
    } = body

    if (!change_type || !requested_by) {
      return NextResponse.json(
        { error: 'change_type and requested_by are required' },
        { status: 400 }
      )
    }

    // Check practice scheduling mode
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('scheduling_mode')
      .eq('id', practiceId)
      .single()

    const mode = practice?.scheduling_mode || 'notification'

    // Determine initial status based on mode
    let initialStatus = 'pending'
    if (mode === 'harbor_driven') {
      initialStatus = 'auto_confirmed'
    }

    const { data, error } = await supabaseAdmin
      .from('schedule_changes')
      .insert({
        practice_id: practiceId,
        appointment_id,
        patient_id,
        change_type,
        previous_time,
        new_time,
        requested_by,
        dob_verified: dob_verified || false,
        status: initialStatus,
        confirmed_at: initialStatus === 'auto_confirmed' ? new Date().toISOString() : null,
        notes,
      })
      .select()
      .single()

    if (error) {
      console.error('[schedule-changes POST]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // If harbor_driven mode, also update the actual appointment
    if (mode === 'harbor_driven' && appointment_id && new_time && change_type === 'rescheduled') {
      await supabaseAdmin
        .from('appointments')
        .update({ scheduled_at: new_time })
        .eq('id', appointment_id)
    }

    // TODO: Send notification to therapist (SMS/email) for 'notification' mode

    return NextResponse.json({ change: data }, { status: 201 })
  } catch (err) {
    console.error('[schedule-changes POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

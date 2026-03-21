// Waitlist management API
// GET /api/waitlist — list waitlist patients
// POST /api/waitlist — add a patient to the waitlist

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const practiceId = request.nextUrl.searchParams.get('practice_id')

    let query = supabaseAdmin
      .from('waitlist')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })

    if (practiceId) {
      query = query.eq('practice_id', practiceId)
    }

    const { data: patients, error } = await query

    if (error) {
      console.error('Error fetching waitlist:', error)
      return NextResponse.json({ error: 'Failed to fetch waitlist' }, { status: 500 })
    }

    return NextResponse.json({ patients: patients || [] })
  } catch (error) {
    console.error('Waitlist GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      practice_id,
      patient_name,
      patient_phone,
      patient_email,
      insurance_type,
      session_type,
      reason,
      priority,
      notes,
    } = body

    if (!practice_id || !patient_name || !patient_phone) {
      return NextResponse.json(
        { error: 'Missing required fields: practice_id, patient_name, patient_phone' },
        { status: 400 }
      )
    }

    const { data: patient, error } = await supabaseAdmin
      .from('waitlist')
      .insert({
        practice_id,
        patient_name,
        patient_phone,
        patient_email: patient_email || null,
        insurance_type: insurance_type || 'unknown',
        session_type: session_type || null,
        reason: reason || null,
        priority: priority || 'standard',
        status: 'waiting',
        notes: notes || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('Error adding to waitlist:', error)
      return NextResponse.json({ error: 'Failed to add patient to waitlist' }, { status: 500 })
    }

    return NextResponse.json({ patient }, { status: 201 })
  } catch (error) {
    console.error('Waitlist POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

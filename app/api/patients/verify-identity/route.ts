// Patient Identity Verification (HIPAA)
// POST /api/patients/verify-identity
// Verifies a patient's date of birth before allowing schedule changes
// Used by Ellie (voice) and dashboard before any appointment modifications

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { patient_id, patient_phone, date_of_birth, practice_id } = body

    if (!date_of_birth || !practice_id) {
      return NextResponse.json(
        { error: 'date_of_birth and practice_id are required' },
        { status: 400 }
      )
    }

    if (!patient_id && !patient_phone) {
      return NextResponse.json(
        { error: 'Either patient_id or patient_phone is required' },
        { status: 400 }
      )
    }

    // Look up patient
    let query = supabaseAdmin
      .from('patients')
      .select('id, first_name, last_name, date_of_birth')
      .eq('practice_id', practice_id)

    if (patient_id) {
      query = query.eq('id', patient_id)
    } else {
      query = query.eq('phone', patient_phone)
    }

    const { data: patient, error } = await query.single()

    if (error || !patient) {
      return NextResponse.json(
        { verified: false, reason: 'Patient not found' },
        { status: 404 }
      )
    }

    // Check if patient has DOB on file
    if (!patient.date_of_birth) {
      // First time — store it and consider verified
      await supabaseAdmin
        .from('patients')
        .update({ date_of_birth })
        .eq('id', patient.id)

      return NextResponse.json({
        verified: true,
        first_verification: true,
        patient_id: patient.id,
        patient_name: `${patient.first_name} ${patient.last_name}`,
      })
    }

    // Compare DOB (normalize to YYYY-MM-DD)
    const storedDob = new Date(patient.date_of_birth).toISOString().split('T')[0]
    const providedDob = new Date(date_of_birth).toISOString().split('T')[0]

    if (storedDob === providedDob) {
      return NextResponse.json({
        verified: true,
        first_verification: false,
        patient_id: patient.id,
        patient_name: `${patient.first_name} ${patient.last_name}`,
      })
    } else {
      return NextResponse.json({
        verified: false,
        reason: 'Date of birth does not match our records',
        patient_id: patient.id,
      })
    }
  } catch (err) {
    console.error('[patients/verify-identity POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

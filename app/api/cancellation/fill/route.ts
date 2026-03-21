import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import twilio from 'twilio'

export async function POST(request: NextRequest) {
  try {
    const { practice_id, slot_time, was_telehealth } = await request.json()

    if (!practice_id || !slot_time) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Get practice info
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('name, phone_number')
      .eq('id', practice_id)
      .single()

    if (!practice) {
      return NextResponse.json(
        { error: 'Practice not found' },
        { status: 404 }
      )
    }

    // Build query — telehealth patients first if slot was telehealth
    let query = supabaseAdmin
      .from('waitlist')
      .select('*')
      .eq('practice_id', practice_id)
      .eq('status', 'waiting')

    if (was_telehealth) {
      query = query.order('session_type', { ascending: false }) // telehealth sorts before in-person
    }

    const { data: candidates } = await query
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)

    if (!candidates || candidates.length === 0) {
      return NextResponse.json({
        message: 'No waitlist patients available',
      })
    }

    const patient = candidates[0]
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const slotFormatted = new Date(slot_time).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })

    // Update waitlist
    const { error: updateError } = await supabaseAdmin
      .from('waitlist')
      .update({
        status: 'fill_offered',
        offer_expires_at: expiresAt,
        offered_slot: slot_time,
        fill_offered_at: new Date().toISOString(),
      })
      .eq('id', patient.id)

    if (updateError) {
      console.error('Error updating waitlist:', updateError)
      return NextResponse.json(
        { error: 'Failed to update waitlist' },
        { status: 500 }
      )
    }

    // Send Twilio SMS
    if (
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER &&
      patient.patient_phone
    ) {
      try {
        const client = twilio(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        )
        const sessionType = was_telehealth ? 'telehealth (video)' : 'in-person'
        await client.messages.create({
          to: patient.patient_phone,
          from: process.env.TWILIO_PHONE_NUMBER,
          body: `Hi ${patient.patient_name}, a ${sessionType} appointment just opened at ${practice.name} on ${slotFormatted}. Reply YES to claim it — you have 10 minutes. Harbor AI`,
        })
        console.log(`✓ Fill offer SMS sent to ${patient.patient_phone}`)
      } catch (smsErr) {
        console.error('Error sending fill offer SMS:', smsErr)
      }
    }

    return NextResponse.json({ success: true, patient })
  } catch (error) {
    console.error('Cancellation fill error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

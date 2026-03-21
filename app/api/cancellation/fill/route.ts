// Smart cancellation fill
// When a patient cancels, automatically text waitlisted/high-need patients to offer the slot
// POST /api/cancellation/fill

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendSMS } from '@/lib/twilio'
import { sendEmail, buildCancellationFillEmail } from '@/lib/email'

const BATCH_SIZE = 3 // How many patients to text per round

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { practiceId, appointmentId, cancelledPatientName, slotTime, therapistName } = body

    if (!practiceId || !slotTime) {
      return NextResponse.json(
        { error: 'Missing required fields: practiceId, slotTime' },
        { status: 400 }
      )
    }

    // Get practice info (for the from-number)
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('id, name, phone_number, notification_email, ai_name')
      .eq('id', practiceId)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    }

    // Get top waitlist patients prioritized by:
    // 1. flagged as "high_need" or "flexible"
    // 2. longest time on waitlist
    const { data: waitlistPatients } = await supabaseAdmin
      .from('waitlist')
      .select('id, patient_name, patient_phone, priority, created_at')
      .eq('practice_id', practiceId)
      .eq('status', 'waiting')
      .order('priority', { ascending: false }) // high_need first
      .order('created_at', { ascending: true }) // then oldest wait time
      .limit(BATCH_SIZE)

    if (!waitlistPatients || waitlistPatients.length === 0) {
      console.log('No waitlist patients to contact for fill')
      return NextResponse.json({ success: true, contacted: 0, message: 'No waitlist patients' })
    }

    const aiName = practice.ai_name || 'Ellie'
    const practiceName = practice.name

    // Text each patient about the opening
    const contacted: string[] = []
    for (const patient of waitlistPatients) {
      if (!patient.patient_phone) continue

      const message =
        `Hi ${patient.patient_name?.split(' ')[0] || 'there'}, this is ${aiName} from ${practiceName}. ` +
        `A spot just opened up for ${slotTime}${therapistName ? ` with ${therapistName}` : ''}. ` +
        `Reply YES to claim it or WAITLIST to stay on the waitlist. First to respond gets the slot!`

      try {
        await sendSMS(patient.patient_phone, message)
        contacted.push(patient.patient_phone)

        // Mark them as "fill_offered" so we know we reached out
        await supabaseAdmin
          .from('waitlist')
          .update({
            status: 'fill_offered',
            fill_offered_at: new Date().toISOString(),
            offered_slot: slotTime,
          })
          .eq('id', patient.id)

        console.log(`✓ Fill offer sent to ${patient.patient_name} (${patient.patient_phone})`)
      } catch (err) {
        console.error(`Error texting ${patient.patient_phone}:`, err)
      }
    }

    // Notify therapist by email
    if (practice.notification_email) {
      await sendEmail({
        to: practice.notification_email,
        subject: `${practiceName} — Cancellation: ${slotTime} slot now open`,
        html: buildCancellationFillEmail({
          practiceName,
          cancelledPatient: cancelledPatientName || 'Patient',
          slotTime,
          contactedCount: contacted.length,
        }),
      })
    }

    // Log the fill attempt
    await supabaseAdmin
      .from('fill_attempts')
      .insert({
        practice_id: practiceId,
        appointment_id: appointmentId || null,
        slot_time: slotTime,
        patients_contacted: contacted,
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      .select()

    console.log(`✓ Cancellation fill: texted ${contacted.length} patients for slot ${slotTime}`)

    return NextResponse.json({
      success: true,
      contacted: contacted.length,
      patients: contacted,
    })
  } catch (error) {
    console.error('❌ Cancellation fill error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Handle incoming CANCEL SMS — trigger fill
export async function GET(request: NextRequest) {
  return NextResponse.json({ status: 'Cancellation fill endpoint active' })
}

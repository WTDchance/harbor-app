// Smart cancellation fill
// When a patient cancels, text the #1 waitlist candidate and give them 10 minutes to claim.
// If they don't respond, move on to the next person.
// Telehealth-flexible patients get priority since those slots are easiest to move.
// POST /api/cancellation/fill

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendSMS } from '@/lib/twilio'
import { sendEmail, buildCancellationFillEmail } from '@/lib/email'

const CLAIM_WINDOW_MINUTES = 10 // How long the top patient has to respond

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { practiceId, appointmentId, cancelledPatientName, slotTime, therapistName, sessionType } = body

    if (!practiceId || !slotTime) {
      return NextResponse.json(
        { error: 'Missing required fields: practiceId, slotTime' },
        { status: 400 }
      )
    }

    // Get practice info
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('id, name, phone_number, notification_email, ai_name')
      .eq('id', practiceId)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    }

    // Priority ordering:
    // 1. Telehealth/flexible patients — easiest slot to fill (video session = no commute needed)
    // 2. high_need priority
    // 3. flexible priority
    // 4. standard
    // Within each tier: longest wait time first
    //
    // We fetch the top candidate — just ONE person gets the offer.
    // If they don't claim within 10 minutes, a follow-up job can call this endpoint again
    // (or a cron can handle expiry — see /api/cancellation/fill/expire).

    // First, try telehealth-eligible patients
    let candidate = null

    if (sessionType === 'telehealth' || sessionType === 'video') {
      // Cancelled slot was telehealth — prioritize patients who prefer telehealth
      const { data: telehealthFirst } = await supabaseAdmin
        .from('waitlist')
        .select('id, patient_name, patient_phone, priority, session_type, created_at')
        .eq('practice_id', practiceId)
        .eq('status', 'waiting')
        .eq('session_type', 'telehealth')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)

      candidate = telehealthFirst?.[0] || null
    }

    // Fall back to highest-priority waitlist patient regardless of session type
    if (!candidate) {
      const { data: topPatient } = await supabaseAdmin
        .from('waitlist')
        .select('id, patient_name, patient_phone, priority, session_type, created_at')
        .eq('practice_id', practiceId)
        .eq('status', 'waiting')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)

      candidate = topPatient?.[0] || null
    }

    if (!candidate) {
      console.log('No waitlist patients to contact for fill')
      return NextResponse.json({ success: true, contacted: 0, message: 'No waitlist patients' })
    }

    const aiName = practice.ai_name || 'Ellie'
    const practiceName = practice.name
    const firstName = candidate.patient_name?.split(' ')[0] || 'there'
    const expiresAt = new Date(Date.now() + CLAIM_WINDOW_MINUTES * 60 * 1000).toISOString()

    const message =
      `Hi ${firstName}, this is ${aiName} from ${practiceName}. ` +
      `A spot just opened up for ${slotTime}${therapistName ? ` with ${therapistName}` : ''}. ` +
      `Reply YES to claim it — you have ${CLAIM_WINDOW_MINUTES} minutes. ` +
      `Reply WAITLIST to stay on the list for a future opening.`

    let contacted = false

    try {
      await sendSMS(candidate.patient_phone, message)
      contacted = true

      // Mark as fill_offered with expiry timestamp
      await supabaseAdmin
        .from('waitlist')
        .update({
          status: 'fill_offered',
          fill_offered_at: new Date().toISOString(),
          offered_slot: slotTime,
          offer_expires_at: expiresAt,
        })
        .eq('id', candidate.id)

      console.log(`✓ Fill offer sent to ${candidate.patient_name} (expires ${expiresAt})`)
    } catch (err) {
      console.error(`Error texting ${candidate.patient_phone}:`, err)
    }

    // Log fill attempt
    await supabaseAdmin
      .from('fill_attempts')
      .insert({
        practice_id: practiceId,
        appointment_id: appointmentId || null,
        slot_time: slotTime,
        patients_contacted: contacted ? [candidate.patient_phone] : [],
        candidate_id: candidate.id,
        candidate_name: candidate.patient_name,
        offer_expires_at: expiresAt,
        status: contacted ? 'pending' : 'failed',
        created_at: new Date().toISOString(),
      })

    // Notify therapist
    if (practice.notification_email) {
      await sendEmail({
        to: practice.notification_email,
        subject: `${practiceName} — Cancellation: ${slotTime} slot offered to ${candidate.patient_name}`,
        html: buildCancellationFillEmail({
          practiceName,
          cancelledPatient: cancelledPatientName || 'Patient',
          slotTime,
          contactedCount: contacted ? 1 : 0,
        }),
      })
    }

    return NextResponse.json({
      success: true,
      contacted: contacted ? 1 : 0,
      candidate: {
        name: candidate.patient_name,
        phone: candidate.patient_phone,
        priority: candidate.priority,
      },
      offer_expires_at: expiresAt,
      message: `Offered slot to ${candidate.patient_name}. They have ${CLAIM_WINDOW_MINUTES} minutes to respond.`,
    })
  } catch (error) {
    console.error('❌ Cancellation fill error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Cancellation fill endpoint active' })
}

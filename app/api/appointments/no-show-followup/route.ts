import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { sendSMS } from '@/lib/twilio'
import { requireApiSession } from '@/lib/aws/api-auth'

// Days and time labels for human-readable messages
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatSlotTime(dateStr: string): string {
  const d = new Date(dateStr)
  const day = DAY_NAMES[d.getDay()]
  const month = d.toLocaleString('en-US', { month: 'short' })
  const date = d.getDate()
  const hours = d.getHours()
  const minutes = d.getMinutes()
  const ampm = hours >= 12 ? 'pm' : 'am'
  const hour12 = hours % 12 || 12
  const minStr = minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : ''
  return `${day}, ${month} ${date} at ${hour12}${minStr}${ampm}`
}

function formatFutureAppt(dateStr: string): string {
  const d = new Date(dateStr)
  const day = DAY_NAMES[d.getDay()]
  const month = d.toLocaleString('en-US', { month: 'long' })
  const date = d.getDate()
  const hours = d.getHours()
  const minutes = d.getMinutes()
  const ampm = hours >= 12 ? 'pm' : 'am'
  const hour12 = hours % 12 || 12
  const minStr = minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : ''
  return `${day}, ${month} ${date} at ${hour12}${minStr}${ampm}`
}

// Detect the patient's preferred day of week and time block from past appointments
function detectPreferences(pastAppointments: Array<{ scheduled_at: string }>): {
  preferredDays: number[]  // 0=Sun ... 6=Sat
  preferredTimeBlock: 'morning' | 'afternoon' | 'evening' | null
} {
  if (!pastAppointments || pastAppointments.length < 2) {
    return { preferredDays: [], preferredTimeBlock: null }
  }

  const dayCounts: Record<number, number> = {}
  const timeBlockCounts: Record<string, number> = { morning: 0, afternoon: 0, evening: 0 }

  for (const appt of pastAppointments) {
    const d = new Date(appt.scheduled_at)
    const dow = d.getDay()
    const hour = d.getHours()
    dayCounts[dow] = (dayCounts[dow] || 0) + 1
    if (hour < 12) timeBlockCounts.morning++
    else if (hour < 17) timeBlockCounts.afternoon++
    else timeBlockCounts.evening++
  }

  // Find most common day(s) — any day with >= 40% of sessions
  const total = pastAppointments.length
  const threshold = Math.max(2, total * 0.4)
  const preferredDays = Object.entries(dayCounts)
    .filter(([, count]) => count >= threshold)
    .map(([day]) => parseInt(day))
    .sort()

  // Most common time block (only if dominant — >50%)
  const maxBlock = Object.entries(timeBlockCounts).sort((a, b) => b[1] - a[1])[0]
  const preferredTimeBlock = maxBlock[1] / total > 0.5
    ? (maxBlock[0] as 'morning' | 'afternoon' | 'evening')
    : null

  return { preferredDays, preferredTimeBlock }
}

// Find open slots that match preferred days/time blocks
function rankSlots(
  openSlots: Array<{ id: string; scheduled_at: string }>,
  preferredDays: number[],
  preferredTimeBlock: 'morning' | 'afternoon' | 'evening' | null
): Array<{ id: string; scheduled_at: string }> {
  const scored = openSlots.map(slot => {
    const d = new Date(slot.scheduled_at)
    const dow = d.getDay()
    const hour = d.getHours()
    let timeBlock = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
    let score = 0
    if (preferredDays.includes(dow)) score += 3
    if (preferredTimeBlock && timeBlock === preferredTimeBlock) score += 2
    return { ...slot, score }
  })
  return scored.sort((a, b) => b.score - a.score || 
    new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
}

// Build the personalized SMS message
function buildNoShowMessage({
  patientName,
  providerName,
  missedDate,
  futureAppointments,
  matchingSlots,
  openSlots,
  preferredDays,
  preferredTimeBlock,
}: {
  patientName: string
  providerName: string
  missedDate: string
  futureAppointments: Array<{ scheduled_at: string }>
  matchingSlots: Array<{ id: string; scheduled_at: string }>
  openSlots: Array<{ id: string; scheduled_at: string }>
  preferredDays: number[]
  preferredTimeBlock: 'morning' | 'afternoon' | 'evening' | null
}): string {
  const firstName = patientName.split(' ')[0]
  const missed = new Date(missedDate)
  const missedLabel = SHORT_DAY_NAMES[missed.getDay()] + ' ' +
    missed.toLocaleString('en-US', { month: 'short' }) + ' ' + missed.getDate()

  // Case 1: Patient already has a future appointment scheduled
  if (futureAppointments.length > 0) {
    const next = futureAppointments[0]
    const nextLabel = formatFutureAppt(next.scheduled_at)
    return [
      `Harbor: Hi ${firstName}, we missed you today (${missedLabel}) with ${providerName}.`,
      `No worries — your next session is already scheduled for ${nextLabel}.`,
      `If you need to talk sooner or want to reschedule, just reply to this message and we'll take care of it.`,
    ].join(' ')
  }

  // Case 2: Open slots that match the patient's usual day/time preferences
  if (matchingSlots.length > 0) {
    const topSlots = matchingSlots.slice(0, 2)
    const slotLines = topSlots.map(s => formatSlotTime(s.scheduled_at)).join(' or ')
    const prefNote = preferredDays.length > 0
      ? ` (looks like you usually come in on ${preferredDays.map(d => DAY_NAMES[d]).join('/')})`
      : ''
    return [
      `Harbor: Hi ${firstName}, we noticed you missed your appointment on ${missedLabel}.`,
      `We have openings that fit your usual schedule${prefNote}: ${slotLines}.`,
      `Reply with your preferred time or just say RESCHEDULE and we'll get you booked. We'd love to see you soon.`,
    ].join(' ')
  }

  // Case 3: Open slots exist but none match preferences — offer nearest 2-3
  if (openSlots.length > 0) {
    const topSlots = openSlots.slice(0, 3)
    const slotLines = topSlots.map(s => formatSlotTime(s.scheduled_at)).join(', ')
    return [
      `Harbor: Hi ${firstName}, we missed you at your appointment on ${missedLabel}.`,
      `We have the following openings available: ${slotLines}.`,
      `Reply with a time that works or say RESCHEDULE and we'll find something that fits.`,
    ].join(' ')
  }

  // Case 4: No open slots at all — gentle nudge to reach out
  return [
    `Harbor: Hi ${firstName}, we missed you at your appointment on ${missedLabel} with ${providerName}.`,
    `We don't have any openings showing right now, but reach out and we'll do our best to find a time that works for you.`,
  ].join(' ')
}

// POST /api/appointments/no-show-followup
// Body: { appointment_id: string }
// Marks the appointment as no-show, builds personalized outreach, sends SMS
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { appointment_id } = body
    if (!appointment_id) {
      return NextResponse.json({ error: 'appointment_id is required' }, { status: 400 })
    }

    // Get the missed appointment + patient info
    const { data: appt, error: apptError } = await supabase
      .from('appointments')
      .select('id, scheduled_at, patient_id, patient_name, patient_phone, status, practice_id')
      .eq('id', appointment_id)
      .single()

    if (apptError || !appt) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    // Verify this appointment belongs to the authenticated practice
    const { data: practice } = await supabase
      .from('practices')
      .select('id, name, provider_name, phone_number')
      .eq('id', appt.practice_id)
      .eq('auth_user_id', user.id)
      .single()

    if (!practice) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    if (!appt.patient_phone) {
      return NextResponse.json({ error: 'Patient has no phone number on file', sms_sent: false }, { status: 400 })
    }

    // Mark appointment as no-show
    await supabase
      .from('appointments')
      .update({ status: 'no_show', no_show_followup_sent: true, no_show_followup_sent_at: new Date().toISOString() })
      .eq('id', appointment_id)

    const now = new Date()
    const lookAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // 30 days out

    // Check if patient has future appointments already scheduled
    const futureApptQuery = supabase
      .from('appointments')
      .select('id, scheduled_at')
      .eq('practice_id', practice.id)
      .eq('status', 'confirmed')
      .gt('scheduled_at', now.toISOString())
      .lte('scheduled_at', lookAhead.toISOString())
      .order('scheduled_at', { ascending: true })

    // Add patient filter — support both patient_id and phone matching
    if (appt.patient_id) {
      futureApptQuery.eq('patient_id', appt.patient_id)
    } else if (appt.patient_phone) {
      futureApptQuery.eq('patient_phone', appt.patient_phone)
    }

    const { data: futureAppointments } = await futureApptQuery

    // Get patient's appointment history to detect preferences
    let pastAppointments: Array<{ scheduled_at: string }> = []
    if (appt.patient_id || appt.patient_phone) {
      const histQuery = supabase
        .from('appointments')
        .select('scheduled_at')
        .eq('practice_id', practice.id)
        .eq('status', 'completed')
        .lt('scheduled_at', now.toISOString())
        .order('scheduled_at', { ascending: false })
        .limit(20)

      if (appt.patient_id) histQuery.eq('patient_id', appt.patient_id)
      else histQuery.eq('patient_phone', appt.patient_phone)

      const { data } = await histQuery
      pastAppointments = data || []
    }

    // Get open slots in next 14 days
    const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    const { data: openSlots } = await supabase
      .from('appointments')
      .select('id, scheduled_at')
      .eq('practice_id', practice.id)
      .eq('status', 'available')
      .gt('scheduled_at', now.toISOString())
      .lte('scheduled_at', twoWeeks.toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(10)

    // Detect patient preferences
    const { preferredDays, preferredTimeBlock } = detectPreferences(pastAppointments)

    // Rank open slots by preference match
    const rankedSlots = rankSlots(openSlots || [], preferredDays, preferredTimeBlock)
    const matchingSlots = rankedSlots.filter(s => {
      const d = new Date(s.scheduled_at)
      const dow = d.getDay()
      const hour = d.getHours()
      const timeBlock = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
      return preferredDays.includes(dow) || (preferredTimeBlock && timeBlock === preferredTimeBlock)
    })

    // Build personalized message
    const message = buildNoShowMessage({
      patientName: appt.patient_name || 'there',
      providerName: practice.provider_name || practice.name,
      missedDate: appt.scheduled_at,
      futureAppointments: futureAppointments || [],
      matchingSlots,
      openSlots: rankedSlots,
      preferredDays,
      preferredTimeBlock,
    })

    // Send SMS
    let smsSent = false
    try {
      await sendSMS(appt.patient_phone, message)
      smsSent = true
    } catch (smsError) {
      console.error('Failed to send no-show follow-up SMS:', smsError)
    }

    return NextResponse.json({
      success: true,
      sms_sent: smsSent,
      message_preview: message,
      patient_has_future_appointment: (futureAppointments || []).length > 0,
      preferred_days: preferredDays.map(d => DAY_NAMES[d]),
      preferred_time_block: preferredTimeBlock,
      open_slots_found: (openSlots || []).length,
      matching_slots_found: matchingSlots.length,
    })
  } catch (error) {
    console.error('No-show follow-up error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/appointments/no-show-followup?appointment_id=xxx
// Preview the message that would be sent without actually sending it
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const appointment_id = searchParams.get('appointment_id')
    if (!appointment_id) {
      return NextResponse.json({ error: 'appointment_id is required' }, { status: 400 })
    }

    const { data: appt } = await supabase
      .from('appointments')
      .select('id, scheduled_at, patient_id, patient_name, patient_phone, practice_id')
      .eq('id', appointment_id)
      .single()

    if (!appt) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })

    const { data: practice } = await supabase
      .from('practices')
      .select('id, name, provider_name')
      .eq('id', appt.practice_id)
      .eq('auth_user_id', user.id)
      .single()

    if (!practice) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const now = new Date()
    const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    const lookAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    const futureQuery = supabase
      .from('appointments')
      .select('id, scheduled_at')
      .eq('practice_id', practice.id)
      .eq('status', 'confirmed')
      .gt('scheduled_at', now.toISOString())
      .lte('scheduled_at', lookAhead.toISOString())
      .order('scheduled_at', { ascending: true })
    if (appt.patient_id) futureQuery.eq('patient_id', appt.patient_id)
    else if (appt.patient_phone) futureQuery.eq('patient_phone', appt.patient_phone)
    const { data: futureAppointments } = await futureQuery

    let pastAppointments: Array<{ scheduled_at: string }> = []
    if (appt.patient_id || appt.patient_phone) {
      const histQuery = supabase
        .from('appointments')
        .select('scheduled_at')
        .eq('practice_id', practice.id)
        .eq('status', 'completed')
        .lt('scheduled_at', now.toISOString())
        .order('scheduled_at', { ascending: false })
        .limit(20)
      if (appt.patient_id) histQuery.eq('patient_id', appt.patient_id)
      else histQuery.eq('patient_phone', appt.patient_phone)
      const { data } = await histQuery
      pastAppointments = data || []
    }

    const { data: openSlots } = await supabase
      .from('appointments')
      .select('id, scheduled_at')
      .eq('practice_id', practice.id)
      .eq('status', 'available')
      .gt('scheduled_at', now.toISOString())
      .lte('scheduled_at', twoWeeks.toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(10)

    const { preferredDays, preferredTimeBlock } = detectPreferences(pastAppointments)
    const rankedSlots = rankSlots(openSlots || [], preferredDays, preferredTimeBlock)
    const matchingSlots = rankedSlots.filter(s => {
      const d = new Date(s.scheduled_at)
      const dow = d.getDay()
      const hour = d.getHours()
      const timeBlock = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
      return preferredDays.includes(dow) || (preferredTimeBlock && timeBlock === preferredTimeBlock)
    })

    const message = buildNoShowMessage({
      patientName: appt.patient_name || 'there',
      providerName: practice.provider_name || practice.name,
      missedDate: appt.scheduled_at,
      futureAppointments: futureAppointments || [],
      matchingSlots,
      openSlots: rankedSlots,
      preferredDays,
      preferredTimeBlock,
    })

    return NextResponse.json({
      message_preview: message,
      patient_has_future_appointment: (futureAppointments || []).length > 0,
      future_appointments: futureAppointments,
      preferred_days: preferredDays.map(d => DAY_NAMES[d]),
      preferred_time_block: preferredTimeBlock,
      open_slots_found: (openSlots || []).length,
      matching_slots_found: matchingSlots.length,
    })
  } catch (error) {
    console.error('No-show preview error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

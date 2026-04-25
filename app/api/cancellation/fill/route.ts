import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import twilio from 'twilio'

// Check if a patient's preferred_times text matches a given slot
function matchesPreferredTime(preferredTimes: string | null, slotDate: Date): boolean {
    if (!preferredTimes) return false
    const pref = preferredTimes.toLowerCase()

  // Match day of week
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const shortDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const slotDay = slotDate.getDay()
    const dayMatch = pref.includes(dayNames[slotDay]) || pref.includes(shortDays[slotDay])

  // Match time of day
  const slotHour = slotDate.getHours()
    const isMorning = slotHour >= 8 && slotHour < 12
        const isAfternoon = slotHour >= 12 && slotHour < 17
            const isEvening = slotHour >= 17
    const timeMatch =
          (isMorning && (pref.includes('morning') || pref.includes('am'))) ||
          (isAfternoon && (pref.includes('afternoon') || pref.includes('after lunch'))) ||
          (isEvening && (pref.includes('evening') || pref.includes('after 5') || pref.includes('after work')))

  // Match if either day or time matches (generous matching)
  return dayMatch || timeMatch
}

export async function POST(request: NextRequest) {
    try {
          const { practice_id, slot_time, was_telehealth } = await request.json()

      if (!practice_id || !slot_time) {
              return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
                      )
      }

      const slotDate = new Date(slot_time)

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

      // ── Step 1: Check waitlist (existing flow, priority-based) ──
      let query = supabaseAdmin
            .from('waitlist')
            .select('*')
            .eq('practice_id', practice_id)
            .eq('status', 'waiting')

      if (was_telehealth) {
              query = query.order('session_type', { ascending: false })
      }

      const { data: waitlistCandidates } = await query
            .order('priority', { ascending: false })
            .order('created_at', { ascending: true })
            .limit(5)

      // ── Step 2: Check patients with matching preferred_times ──
      // Find patients who previously called and mentioned time preferences
      // that match this cancelled slot
      const { data: preferredPatients } = await supabaseAdmin
            .from('patients')
            .select('id, first_name, last_name, phone, preferred_session_type, preferred_times:call_logs(preferred_times)')
            .eq('practice_id', practice_id)
            .not('phone', 'is', null)
            .limit(50)

      // Also check call_logs directly for preferred_times data
      const { data: recentCallsWithPrefs } = await supabaseAdmin
            .from('call_logs')
            .select('id, patient_id, caller_name, patient_phone, preferred_times, session_type, call_type')
            .eq('practice_id', practice_id)
            .not('preferred_times', 'is', null)
            .in('call_type', ['new_patient', 'scheduling', 'existing_patient'])
            .order('created_at', { ascending: false })
            .limit(50)

      // Score preferred-time matches
      const preferredMatches = (recentCallsWithPrefs || [])
            .filter(call => matchesPreferredTime(call.preferred_times, slotDate))
            .filter(call => {
                      // If slot was telehealth, prefer telehealth patients (but don't exclude)
                            if (was_telehealth && call.session_type === 'in-person') return false
                      if (!was_telehealth && call.session_type === 'telehealth') return false
                      return true
            })

      // ── Step 3: Decide who to contact ──
      // Waitlist patients get priority, then preferred-time matches
      let contacted: any[] = []

            // Contact waitlist patient first (existing behavior)
            if (waitlistCandidates && waitlistCandidates.length > 0) {
                    const patient = waitlistCandidates[0]
                    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

            await supabaseAdmin     .from('waitlist')
                      .update({
                                  status: 'fill_offered',
                                  offer_expires_at: expiresAt,
                                  offered_slot: slot_time,
                                  fill_offered_at: new Date().toISOString(),
                      })
                      .eq('id', patient.id)

            await sendFillSMS(patient.patient_phone, patient.patient_name, practice.name, slot_time, was_telehealth)
                    contacted.push({ source: 'waitlist', name: patient.patient_name, phone: patient.patient_phone })
            }

      // If no waitlist match, contact preferred-time patients
      if (contacted.length === 0 && preferredMatches.length > 0) {
              const match = preferredMatches[0]
              await sendFillSMS(match.patient_phone, match.caller_name || 'there', practice.name, slot_time, was_telehealth)
              contacted.push({
                        source: 'preferred_times',
                        name: match.caller_name,
                        phone: match.patient_phone,
                        matched_preference: match.preferred_times,
              })
              console.log(`✓ Preferred-time match: ${match.caller_name} (pref: "${match.preferred_times}") for slot ${slot_time}`)
      }

      if (contacted.length === 0) {
              return NextResponse.json({ message: 'No matching patients found for this slot' })
      }

      return NextResponse.json({ success: true, contacted })
    } catch (error) {
          console.error('Cancellation fill error:', error)
          return NextResponse.json(
            { error: 'Internal server error' },   { status: 500 }
                )
    }
}

async function sendFillSMS(
    phone: string,
    name: string,
    practiceName: string,
    slotTime: string,
    wasTelehealth: boolean
  ) {
    if (
          !process.env.TWILIO_ACCOUNT_SID ||
          !process.env.TWILIO_AUTH_TOKEN ||
          !process.env.TWILIO_PHONE_NUMBER ||
          !phone
        ) return

  try {
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
        const sessionType = wasTelehealth ? 'telehealth (video)' : 'in-person'
        const slotFormatted = new Date(slotTime).toLocaleString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
        })

      const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
        const messageParams: Record<string, string> = {
                to: phone,
                body: `Harbor: Hi ${name}, a ${sessionType} appointment just opened at ${practiceName} on ${slotFormatted}. Reply YES to claim it — you have 10 minutes. Reply STOP to opt out. Harbor AI`,
        }
        if (messagingServiceSid) {
                messageParams.messagingServiceSid = messagingServiceSid
        } else {
                messageParams.from = process.env.TWILIO_PHONE_NUMBER || ''
        }
        await client.messages.create(messageParams as any)
        console.log(`✓ Fill offer SMS sent to ${phone}`)
      } catch (smsErr) {
        console.error('Error sending fill offer SMS:', smsErr)
  }
}

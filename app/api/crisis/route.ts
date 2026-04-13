import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { sendSMS } from '@/lib/twilio'

const CRISIS_PHRASES = [
  'suicide', 'suicidal', 'kill myself', 'end my life', 'want to die',
  "don't want to be here", 'not worth living', 'hurt myself', 'harm myself',
  'self harm', 'self-harm', 'cut myself', 'overdose', 'no reason to live',
  "can't go on", 'hopeless', 'worthless', 'nothing to live for',
  'goodbye forever', 'ending it all', "won't be around", 'final goodbye',
  'take my own life', 'rather be dead', 'better off dead', 'want it to end'
]

export function detectCrisis(text: string): { detected: boolean; phrases: string[] } {
  const lower = text.toLowerCase()
  const phrases = CRISIS_PHRASES.filter(p => lower.includes(p))
  return { detected: phrases.length > 0, phrases }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { transcript, caller_phone, patient_name, appointment_id } = body

    if (!transcript) {
      return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
    }

    const { detected, phrases } = detectCrisis(transcript)

    if (!detected) {
      return NextResponse.json({ crisis_detected: false, phrases: [], alert_sent: false })
    }

    // Get practice info for alert destination
    const { data: practice } = await supabase
      .from('practices')
      .select('id, name, phone_number, crisis_phone, provider_name')
      .eq('auth_user_id', user.id)
      .single()

    let alertSent = false
    const alertPhone = practice?.crisis_phone || practice?.phone_number

    if (alertPhone) {
      const patientLabel = patient_name || caller_phone || 'Unknown caller'
      const snippet = transcript.length > 200 ? transcript.substring(0, 200) + '...' : transcript
      
      const alertMsg = [
        '🚨 HARBOR CRISIS ALERT 🚨',
        `Practice: ${practice?.name || 'Your practice'}`,
        `Caller: ${patientLabel}`,
        `Phrases detected: ${phrases.join(', ')}`,
        '',
        `Transcript snippet: "${snippet}"`,
        '',
        'If in immediate danger, call 911.',
        '988 Suicide & Crisis Lifeline: call or text 988'
      ].join('\n')

      try {
        await sendSMS(alertPhone, alertMsg)
        alertSent = true
      } catch (smsError) {
        console.error('Failed to send crisis SMS alert:', smsError)
      }
    }

    // Log to crisis_alerts table (non-fatal if table doesn't exist yet)
    try {
      await supabase.from('crisis_alerts').insert({
        practice_id: practice?.id,
        caller_phone: caller_phone || null,
        patient_name: patient_name || null,
        appointment_id: appointment_id || null,
        transcript_snippet: transcript.substring(0, 500),
        detected_phrases: phrases,
        alert_sent: alertSent,
        alert_sent_to: alertSent ? alertPhone : null,
        created_at: new Date().toISOString()
      })
    } catch (dbError) {
      console.warn('Could not log crisis alert to DB (table may not exist):', dbError)
    }

    return NextResponse.json({
      crisis_detected: true,
      phrases,
      alert_sent: alertSent
    })

  } catch (error) {
    console.error('Crisis detection error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { sendSMS } from '@/lib/aws/signalwire'
import { detectCrisis } from '@/lib/crisis-phrases'

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

    const { immediateCrisis, concernDetected, immediateMatches, concernMatches } = detectCrisis(transcript)

    if (!immediateCrisis && !concernDetected) {
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

    // Only send SMS for Tier 1 (immediate crisis) — unambiguous signals only.
    // Tier 2 (concern) phrases are logged but don't trigger SMS alerts,
    // because without contextual analysis they could be false positives.
    if (immediateCrisis && alertPhone) {
      const patientLabel = patient_name || caller_phone || 'Unknown caller'
      const snippet = transcript.length > 200 ? transcript.substring(0, 200) + '...' : transcript

      const alertMsg = [
        '🚨 HARBOR CRISIS ALERT 🚨',
        `Practice: ${practice?.name || 'Your practice'}`,
        `Caller: ${patientLabel}`,
        `Crisis phrases detected: ${immediateMatches.join(', ')}`,
        '',
        `Transcript snippet: "${snippet}"`,
        '',
        'If in immediate danger, call 911.',
        '988 Suicide & Crisis Lifeline: call or text 988'
      ].join('\n')

      try {
        const r = await sendSMS({
          to: alertPhone,
          body: alertMsg,
          practiceId: practice?.id ?? null,
        })
        if (r.ok) {
          alertSent = true
        } else {
          console.error('Failed to send crisis SMS alert:', r.reason)
        }
      } catch (smsError) {
        console.error('Failed to send crisis SMS alert:', smsError)
      }
    }

    // Log ALL detections (both tiers) to crisis_alerts table for therapist review
    try {
      await supabase.from('crisis_alerts').insert({
        practice_id: practice?.id,
        caller_phone: caller_phone || null,
        patient_name: patient_name || null,
        appointment_id: appointment_id || null,
        transcript_snippet: transcript.substring(0, 500),
        detected_phrases: [...immediateMatches, ...concernMatches],
        alert_sent: alertSent,
        alert_sent_to: alertSent ? alertPhone : null,
        crisis_level: immediateCrisis ? 'crisis' : 'concern',
        created_at: new Date().toISOString()
      })
    } catch (dbError) {
      console.warn('Could not log crisis alert to DB (table may not exist):', dbError)
    }

    return NextResponse.json({
      crisis_detected: immediateCrisis,
      concern_detected: concernDetected,
      phrases: [...immediateMatches, ...concernMatches],
      alert_sent: alertSent
    })

  } catch (error) {
    console.error('Crisis detection error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

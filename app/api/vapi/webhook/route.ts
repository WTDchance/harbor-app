// Harbor AI Receptionist â Vapi.ai Webhook Handler
// Handles all Vapi server events: assistant-request, function-call, end-of-call-report, status-update
// Dynamic per-practice assistant config via assistant-request for multi-tenant support

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateCallSummary, extractCallInformation, detectCrisisIndicators } from '@/lib/claude'
import { getCallSummaryPrompt } from '@/lib/ai-prompts'
import { sendEmail, buildCallSummaryEmail } from '@/lib/email'
import { buildSystemPrompt } from '@/lib/systemPrompt'
import twilio from 'twilio'
import { formatPhoneNumber } from '@/lib/twilio'

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER

// ââ Crisis keywords for fast detection (Tier 1) âââââââââââââââââââââââââââââ
const IMMEDIATE_CRISIS = [
  'kill myself', 'end my life', 'take my own life', 'suicide', 'suicidal',
  'want to die', 'rather be dead', 'better off dead', 'ending it all',
  'going to hurt myself', 'going to harm myself', 'overdose',
  'not going to be around', 'no reason to live', 'nothing to live for',
]

const CONCERN_PHRASES = [
  "don't want to be here", "can't do this anymore", "can't go on",
  'tired of everything', 'given up', 'hopeless', 'worthless',
  'no one cares', 'just want it to stop', 'cancel all my appointments',
  'panic attack', "can't stop crying", 'relapsed', 'using again',
]

// ââ Helpers ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function resolvePractice(call: any, message: any) {
  // Try metadata first (set when creating outbound calls)
  let practiceId: string | null = call?.metadata?.practiceId || null

  if (!practiceId) {
    // Resolve by the Twilio phone number Vapi called
    const calledNumber =
      call?.phoneNumber?.number ||
      message?.phoneNumber?.number ||
      call?.phoneNumber?.twilioPhoneNumber ||
      null

    if (calledNumber) {
      // Exact match
      const { data: exact } = await supabaseAdmin
        .from('practices')
        .select('*')
        .eq('phone_number', calledNumber)
        .single()

      if (exact) return exact

      // Normalized match (strip country code)
      const digits = calledNumber.replace(/\D/g, '').slice(-10)
      const { data: allPractices } = await supabaseAdmin
        .from('practices')
        .select('*')
      if (allPractices) {
        const match = allPractices.find(
          (p: any) => p.phone_number?.replace(/\D/g, '').slice(-10) === digits
        )
        if (match) return match
      }
    }
  }

  if (practiceId) {
    const { data } = await supabaseAdmin
      .from('practices')
      .select('*')
      .eq('id', practiceId)
      .single()
    return data
  }

  return null
}

function detectCrisis(transcript: string): { crisis: boolean; concern: boolean; phrases: string[] } {
  const lower = transcript.toLowerCase()
  const crisisMatches = IMMEDIATE_CRISIS.filter(p => lower.includes(p))
  if (crisisMatches.length > 0) {
    return { crisis: true, concern: true, phrases: crisisMatches }
  }
  const concernMatches = CONCERN_PHRASES.filter(p => lower.includes(p))
  return { crisis: false, concern: concernMatches.length > 0, phrases: concernMatches }
}

// ââ Main webhook handler âââââââââââââââââââââââââââââââââââââââââââââââââââââ

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const secret = request.nextUrl.searchParams.get('secret')
    if (process.env.VAPI_WEBHOOK_SECRET && secret !== process.env.VAPI_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const message = body.message || body
    const type = message.type
    const call = message.call

    console.log(`[Vapi] ${type} | call: ${call?.id || 'N/A'}`)

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    // ASSISTANT REQUEST â Dynamic per-practice assistant configuration
    // Vapi sends this when an inbound call arrives. We return a transient
    // assistant with the right system prompt, voice, and tools for that
    // practice. Must respond within 7.5 seconds.
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (type === 'assistant-request') {
      const practice = await resolvePractice(call, message)

      if (!practice) {
        console.warn('[Vapi] assistant-request: could not resolve practice')
        // Return a generic fallback assistant
        return NextResponse.json({
          assistant: {
            firstMessage: "Thank you for calling. I'm sorry, but I'm having trouble connecting to the practice's system right now. Please try calling back in a few minutes, or leave your name and number and someone will get back to you.",
            model: {
              provider: 'google',
              model: 'gemini-2.0-flash',
              messages: [
                {
                  role: 'system',
                  content: 'You are a helpful receptionist. The practice lookup failed. Be apologetic, collect their name and phone number, and let them know someone will call back.',
                },
              ],
            },
            voice: {
              provider: 'vapi',
              voiceId: 'sarah',
            },
          },
        })
      }

      // Build human-readable hours from hours_json
      const hoursText = formatHoursJson(practice.hours_json)

      // Build the dynamic system prompt from practice data
      // Column names match onboarding_profile migration (provider_name, telehealth_available, etc.)
      const systemPrompt = buildSystemPrompt({
        therapist_name: practice.provider_name || practice.name,
        practice_name: practice.name,
        ai_name: practice.ai_name || 'Harbor',
        specialties: practice.specialties || [],
        hours: hoursText,
        location: practice.location || '',
        telehealth: practice.telehealth_available ?? true,
        insurance_accepted: practice.insurance_accepted || [],
        system_prompt_notes: practice.system_prompt_notes || '',
        emotional_support_enabled: practice.emotional_support_enabled ?? true,
      })

      const aiName = practice.ai_name || 'Harbor'
      const practiceName = practice.name || 'the practice'

      return NextResponse.json({
        assistant: {
          // First spoken message
          firstMessage: `Good ${getTimeOfDay()}, this is ${aiName} with ${practiceName}. How can I help you today?`,

          // LLM â Gemini 2.0 Flash via BYOM (use your own API key in Vapi dashboard)
          model: {
            provider: 'google',
            model: 'gemini-2.0-flash',
            messages: [
              { role: 'system', content: systemPrompt },
            ],
            temperature: 0.4,
          },

          // Voice â warm, professional female
          voice: {
            provider: 'vapi',
            voiceId: 'sarah',
          },

          // Transcription
          transcriber: {
            provider: 'deepgram',
            model: 'nova-2',
            language: 'en',
          },

          // Pass practice context as metadata for later webhook events
          metadata: {
            practiceId: practice.id,
            practiceName: practice.name,
            therapistName: practice.provider_name || practice.name,
          },

          // End-of-call settings
          endCallMessage: `Thank you for calling ${practiceName}. Have a wonderful day!`,

          // Server URL for function calls (points back to this webhook)
          serverUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'}/api/vapi/webhook${process.env.VAPI_WEBHOOK_SECRET ? '?secret=' + process.env.VAPI_WEBHOOK_SECRET : ''}`,

          // Tools the assistant can call
          tools: [
            {
              type: 'function',
              function: {
                name: 'collectIntakeInfo',
                description: 'Save new patient intake information after collecting their details during the call. Call this when you have gathered the patient name, phone, and reason for seeking therapy.',
                parameters: {
                  type: 'object',
                        properties: {
                    patientName: { type: 'string', description: 'Full name of the patient' },
                    patientPhone: { type: 'string', description: 'Patient phone number' },
                    patientEmail: { type: 'string', description: 'Patient email address (if provided)' },
                    insurance: { type: 'string', description: 'Insurance provider or self-pay' },
                    reasonForSeeking: { type: 'string', description: 'Why they are seeking therapy' },
                    preferredTimes: { type: 'string', description: 'Preferred appointment days/times' },
                    telehealthPreference: { type: 'string', description: 'telehealth, in-person, or no preference' },
                    phq2Score: { type: 'number', description: 'PHQ-2 depression screening score (0-6)' },
                    gad2Score: { type: 'number', description: 'GAD-2 anxiety screening score (0-6)' },
                  },
                  required: ['patientName'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'checkAvailability',
                description: 'Check appointment availability when a patient asks about open times.',
                parameters: {
                  type: 'object',
                  properties: {
                    preferredDay: { type: 'string', description: 'Day of week or date preference' },
                    preferredTime: { type: 'string', description: 'Time of day preference (morning/afternoon/evening)' },
                  },
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'takeMessage',
                description: 'Take a message for the therapist when the caller wants to leave a note or callback request.',
                parameters: {
                  type: 'object',
                  properties: {
                    callerName: { type: 'string', description: 'Name of the caller' },
                    callerPhone: { type: 'string', description: 'Callback phone number' },
                    message: { type: 'string', description: 'The message to pass along' },
                    urgent: { type: 'boolean', description: 'Whether the message is urgent' },
                  },
                  required: ['message'],
                },
              },
            },
            {
              type: 'function',
              function: {
                name: 'submitIntakeScreening',
                description: 'Submit PHQ-2 and GAD-2 screening scores after asking the 4 screening questions.',
                parameters: {
                  type: 'object',
                  properties: {
                    patientName: { type: 'string', description: 'Patient name' },
                    phq2Score: { type: 'number', description: 'PHQ-2 score (Q1+Q2, range 0-6)' },
                    gad2Score: { type: 'number', description: 'GAD-2 score (Q3+Q4, range 0-6)' },
                    q1: { type: 'number', description: 'Feeling down/depressed (0-3)' },
                    q2: { type: 'number', description: 'Little interest/pleasure (0-3)' },
                    q3: { type: 'number', description: 'Nervous/anxious/on edge (0-3)' },
                    q4: { type: 'number', description: 'Unable to stop worrying (0-3)' },
                  },
                  required: ['phq2Score', 'gad2Score'],
                },
              },
            },
          ],
        },
      })
    }

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    // FUNCTION CALL â Tool execution during a live call
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (type === 'function-call') {
      const functionName = message.functionCall?.name
      const params = message.functionCall?.parameters || {}
      const practiceId = call?.metadata?.practiceId
      const therapistName = call?.metadata?.therapistName || 'the therapist'

      console.log(`[Vapi] function-call: ${functionName}`, JSON.stringify(params).slice(0, 200))

      if (functionName === 'collectIntakeInfo') {
        if (practiceId) {
          // Save intake data
          await supabaseAdmin
            .from('intake_submissions')
            .insert({
              practice_id: practiceId,
              vapi_call_id: call?.id,
              caller_number: call?.customer?.number || params.patientPhone || null,
              intake_data: params,
            })
            .catch((err: unknown) => console.error('[Vapi] Failed to save intake:', err))

          // Also try to create/update patient record
          if (params.patientName) {
            const nameParts = params.patientName.trim().split(/\s+/)
            const firstName = nameParts[0] || params.patientName
            const lastName = nameParts.slice(1).join(' ') || ''
            const phone = params.patientPhone || call?.customer?.number || ''

            if (phone) {
              // Check if patient exists
              const { data: existing } = await supabaseAdmin
                .from('patients')
                .select('id')
                .eq('practice_id', practiceId)
                .eq('phone', phone)
                .single()

              if (!existing) {
                await supabaseAdmin
                  .from('patients')
                  .insert({
                    practice_id: practiceId,
                    first_name: firstName,
                    last_name: lastName,
                    phone,
                    email: params.patientEmail || null,
                    insurance: params.insurance || null,
                    reason_for_seeking: params.reasonForSeeking || null,
                  })
                  .catch((err: unknown) => console.error('[Vapi] Failed to create patient:', err))
              }
            }
          }
        }

        return NextResponse.json({
          result: `Thank you for sharing that. I've noted all your information. ${therapistName}'s office will reach out within one business day to confirm your appointment.`,
        })
      }

      if (functionName === 'checkAvailability') {
        const preferredDay = params.preferredDay || 'this week'
        const preferredTime = params.preferredTime || ''
        return NextResponse.json({
          result: `I'd love to help with scheduling. ${therapistName} typically has availability within the next 1-2 weeks${preferredTime ? ` for ${preferredTime} appointments` : ''}. Let me take your information and the office will reach out to confirm the best time for you.`,
        })
      }

      if (functionName === 'takeMessage') {
        if (practiceId) {
          // Store as a call log note or intake submission
          await supabaseAdmin
            .from('intake_submissions')
            .insert({
              practice_id: practiceId,
              vapi_call_id: call?.id,
              caller_number: call?.customer?.number || params.callerPhone || null,
              intake_data: {
                type: 'message',
                callerName: params.callerName,
                callerPhone: params.callerPhone,
                message: params.message,
                urgent: params.urgent || false,
              },
            })
            .catch((err: unknown) => console.error('[Vapi] Failed to save message:', err))
        }

        return NextResponse.json({
          result: `I've passed your message along to ${therapistName}. ${params.urgent ? "I've marked it as urgent so they'll see it right away." : "They'll get back to you as soon as possible."}`,
        })
      }

      if (functionName === 'submitIntakeScreening') {
        if (practiceId) {
          await supabaseAdmin
            .from('intake_submissions')
            .insert({
              practice_id: practiceId,
              vapi_call_id: call?.id,
              caller_number: call?.customer?.number || null,
              intake_data: {
                type: 'screening',
                phq2Score: params.phq2Score,
                gad2Score: params.gad2Score,
                q1: params.q1,
                q2: params.q2,
                q3: params.q3,
                q4: params.q4,
                patientName: params.patientName,
                flagged: (params.phq2Score >= 3 || params.gad2Score >= 3),
              },
            })
            .catch((err: unknown) => console.error('[Vapi] Failed to save screening:', err))
        }

        const flagged = params.phq2Score >= 3 || params.gad2Score >= 3
        return NextResponse.json({
          result: flagged
            ? `Thank you for sharing that with me. I want to make sure ${therapistName} has this information before your appointment so they can give you the best care.`
            : `Thank you for answering those questions. I've noted everything for ${therapistName}.`,
        })
      }

      // Unknown function
      return NextResponse.json({ result: 'Noted. Is there anything else I can help you with?' })
    }

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    // STATUS UPDATE â Call lifecycle events
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (type === 'status-update') {
      const status = message.status
      console.log(`[Vapi] status: ${status} | call: ${call?.id}`)
      return NextResponse.json({ received: true })
    }

    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    // END OF CALL REPORT â Post-call processing
    // Save transcript, generate summary, extract patient info, detect crisis
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (type === 'end-of-call-report') {
      const callId = call?.id
      const transcript = message.transcript || call?.transcript || ''
      const duration = message.durationSeconds
        ? Math.round(message.durationSeconds)
        : call?.endedAt && call?.startedAt
          ? Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)
          : 0

      const patientPhone = call?.customer?.number || 'unknown'

      // Resolve practice
      const practice = await resolvePractice(call, message)
      if (!practice) {
        console.warn('[Vapi] end-of-call: could not resolve practice. Call ID:', callId)
        return NextResponse.json({ received: true, callId })
      }

      const practiceId = practice.id
      const therapistName = practice.provider_name || practice.name

      // ââ Crisis detection âââââââââââââââââââââââââââââââââââââââââââââ
      const { crisis: crisisDetected, concern: concernDetected, phrases } = detectCrisis(transcript)

      // For concern-level (not immediate crisis), run deeper AI analysis
      let deepCrisisFlag = crisisDetected
      if (concernDetected && !crisisDetected && transcript.length > 50) {
        try {
          deepCrisisFlag = await detectCrisisIndicators(transcript)
        } catch (err) {
          console.error('[Vapi] Deep crisis check failed:', err)
        }
      }

      // ââ Generate call summary ââââââââââââââââââââââââââââââââââââââââ
      let aiSummary = message.summary || ''
      if (!aiSummary && transcript) {
        try {
          const prompt = getCallSummaryPrompt()
          aiSummary = await generateCallSummary(transcript, prompt)
        } catch (err) {
          console.error('[Vapi] Summary generation failed:', err)
          aiSummary = 'Summary unavailable.'
        }
      }

      // ââ Extract structured info from transcript ââââââââââââââââââââââ
      let extractedInfo: any = {}
      if (transcript && transcript.length > 100) {
        try {
          extractedInfo = await extractCallInformation(transcript)
        } catch (err) {
          console.error('[Vapi] Info extraction failed:', err)
        }
      }

      // ââ Save call log ââââââââââââââââââââââââââââââââââââââââââââââââ
      const { error: dbError } = await supabaseAdmin.from('call_logs').insert({
        vapi_call_id: callId,
        practice_id: practiceId,
        patient_phone: patientPhone,
        transcript,
        summary: aiSummary,
        duration_seconds: duration,
      })
      if (dbError) console.error('[Vapi] Failed to save call log:', dbError)

      // ââ Auto-create patient record if extracted ââââââââââââââââââââââ
      if (extractedInfo.patientName && patientPhone !== 'unknown') {
        const nameParts = extractedInfo.patientName.trim().split(/\s+/)
        const firstName = nameParts[0]
        const lastName = nameParts.slice(1).join(' ') || ''

        const { data: existing } = await supabaseAdmin
          .from('patients')
          .select('id')
          .eq('practice_id', practiceId)
          .eq('phone', patientPhone)
          .single()

        if (!existing) {
          await supabaseAdmin
            .from('patients')
            .insert({
              practice_id: practiceId,
              first_name: firstName,
              last_name: lastName,
              phone: patientPhone,
              email: extractedInfo.patientEmail || null,
              insurance: extractedInfo.patientInsurance || null,
              reason_for_seeking: extractedInfo.reasonForSeeking || null,
            })
            .catch((err: unknown) => console.error('[Vapi] Failed to auto-create patient:', err))
        }
      }

      // ââ Send notification emails (PHI-free) ââââââââââââââââââââââââââ
      const { data: userRecord } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('practice_id', practiceId)
        .single()

      const primaryEmail = userRecord?.email || null
      const notificationEmails: string[] = (practice as any)?.notification_emails || []
      const allEmails = [...new Set([...(primaryEmail ? [primaryEmail] : []), ...notificationEmails])]

      if (allEmails.length > 0) {
        try {
          const { subject: emailSubject, html: emailHtml, from } = buildCallSummaryEmail({
            practiceName: practice.name || 'Your Practice',
            crisisDetected: deepCrisisFlag,
          })
          for (const email of allEmails) {
            await sendEmail({
              to: email,
              subject: emailSubject,
              html: emailHtml,
              from,
            }).catch((err) => console.error('[Vapi] Email failed:', email, err))
          }
        } catch (emailErr) {
          console.error('[Vapi] Email notification failed:', emailErr)
        }
      }

      // ââ Crisis SMS alert to therapist ââââââââââââââââââââââââââââââââ
      if (deepCrisisFlag && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER && process.env.SMS_ENABLED === 'true') {
        try {
          const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
          const alertNumber = (practice as any)?.crisis_alert_phone
          const formattedAlert = alertNumber ? formatPhoneNumber(alertNumber) : null
          if (formattedAlert) {
            await twilioClient.messages.create({
              body: `CRISIS ALERT: A caller may be in distress. Please review the latest call immediately. Call ID: ${callId}`,
              from: TWILIO_PHONE_NUMBER,
              to: formattedAlert,
            })
            console.log('[Vapi] Crisis SMS sent to:', formattedAlert)
          }
        } catch (smsErr) {
          console.error('[Vapi] Crisis SMS failed:', smsErr)
        }
      }

      // ââ Log crisis to crisis_alerts table if it exists âââââââââââââââ
      if (deepCrisisFlag) {
        await supabaseAdmin
          .from('crisis_alerts')
          .insert({
            practice_id: practiceId,
            patient_phone: patientPhone,
            keywords_found: phrases,
            sms_sent: process.env.SMS_ENABLED === 'true',
          })
          .catch((err: unknown) => console.error('[Vapi] Failed to log crisis alert:', err))
      }

      console.log(`[Vapi] end-of-call complete | practice: ${practice.name} | duration: ${duration}s | crisis: ${deepCrisisFlag}`)

      return NextResponse.json({
        received: true,
        callId,
        practiceId,
        crisisDetected: deepCrisisFlag,
        summary: aiSummary.slice(0, 100) + '...',
        extractedInfo,
      })
    }

    // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    // HANG â Call ended or timed out
    // âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (type === 'hang') {
      console.log(`[Vapi] hang | call: ${call?.id}`)
      return NextResponse.json({ received: true })
    }

    // Default: acknowledge unknown events
    console.log(`[Vapi] unhandled event type: ${type}`)
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[Vapi] Webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ââ Utility ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function getTimeOfDay(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function formatHoursJson(hoursJson: any): string {
  if (!hoursJson || typeof hoursJson !== 'object') return 'Monday-Friday 9am-5pm'

  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  const shortNames: Record<string, string> = {
    monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed',
    thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
  }

  const parts: string[] = []
  for (const day of dayNames) {
    const d = hoursJson[day]
    if (d?.enabled && d.openTime && d.closeTime) {
      parts.push(`${shortNames[day]} ${d.openTime}-${d.closeTime}`)
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'Monday-Friday 9am-5pm'
}

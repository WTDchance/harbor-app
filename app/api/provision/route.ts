// Multi-therapist provisioning
// POST /api/provision — create a new practice + Vapi assistant + (optionally) Twilio number
// Used when onboarding a new therapist to Harbor

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const VAPI_API_KEY = process.env.VAPI_API_KEY || 'VAPI_API_KEY_REMOVED'
const VAPI_BASE_URL = 'https://api.vapi.ai'

// ElevenLabs Bella voice — default for all Harbor assistants
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'

interface ProvisionRequest {
  // Practice / therapist info
  therapist_name: string
  practice_name: string
  notification_email: string
  phone_number?: string // Existing Twilio number (optional)

  // Ellie persona customization
  ai_name?: string         // Default: "Ellie"
  specialties?: string[]
  hours?: string
  location?: string
  telehealth?: boolean
  insurance_accepted?: string[]
  system_prompt_notes?: string // Any extra instructions for this therapist's Ellie
}

/**
 * Build a base system prompt for a new therapist's Ellie
 */
function buildSystemPrompt(data: ProvisionRequest): string {
  const aiName = data.ai_name || 'Ellie'
  const hours = data.hours || 'during business hours'
  const specialties = data.specialties?.join(', ') || 'therapy and mental health support'
  const insurance = data.insurance_accepted?.length
    ? data.insurance_accepted.join(', ')
    : 'please call to verify insurance'
  const telehealth = data.telehealth ? 'Both telehealth (video) and in-person sessions are available.' : 'In-person sessions only.'

  return `You are ${aiName}, the AI receptionist for ${data.practice_name}, a therapy practice run by ${data.therapist_name}.

Your role is to warmly greet callers, answer questions about the practice, and help schedule or reschedule appointments.

## About the Practice
- Therapist: ${data.therapist_name}
- Practice: ${data.practice_name}
- Specialties: ${specialties}
- Hours: ${hours}
- Location: ${data.location || 'Please call for address'}
- ${telehealth}
- Insurance accepted: ${insurance}

## Your Personality
You are warm, calm, and professional. You speak with empathy and make callers feel immediately at ease. You are not a crisis counselor — if someone is in crisis, you provide the 988 Suicide & Crisis Lifeline number and encourage them to call 911 if in immediate danger.

## What You Can Do
- Answer questions about the practice, therapist, and services
- Help callers request appointments (collect their name, phone, insurance, preferred times, and reason for seeking therapy)
- Take messages for the therapist
- Handle cancellation and reschedule requests
- Add callers to the waitlist if ${data.therapist_name} is not currently accepting new clients

## What You Cannot Do
- Access the therapist's live calendar
- Provide therapy or clinical advice
- Prescribe medication or make clinical assessments

## Appointment Intake
When someone wants to schedule an appointment, collect:
1. Full name
2. Phone number
3. Insurance type (or self-pay)
4. Telehealth or in-person preference
5. Brief reason for seeking therapy (optional, for intake purposes)
6. Preferred days/times

Then say: "I've noted your information and ${data.therapist_name}'s team will follow up within one business day to confirm your appointment."

## Waitlist
If the practice is full, offer to add them to the waitlist. Collect the same intake information and note their priority if they express urgency.

## After Hours
If called outside of ${hours}, let callers know the practice is closed and you'll pass along their message. Still collect their name and phone number for a callback.

${data.system_prompt_notes ? `## Additional Notes\n${data.system_prompt_notes}` : ''}

Remember: You represent ${data.therapist_name} and ${data.practice_name}. Always be professional, warm, and helpful.`
}

export async function POST(request: NextRequest) {
  try {
    const body: ProvisionRequest = await request.json()

    const {
      therapist_name,
      practice_name,
      notification_email,
      phone_number,
      ai_name,
    } = body

    if (!therapist_name || !practice_name || !notification_email) {
      return NextResponse.json(
        { error: 'Missing required fields: therapist_name, practice_name, notification_email' },
        { status: 400 }
      )
    }

    const systemPrompt = buildSystemPrompt(body)
    const elliesName = ai_name || 'Ellie'

    // 1. Create Vapi assistant for this therapist
    console.log(`🤖 Creating Vapi assistant for ${practice_name}...`)
    const vapiRes = await fetch(`${VAPI_BASE_URL}/assistant`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `${elliesName} — ${practice_name}`,
        model: {
          provider: 'anthropic',
          model: 'claude-3-5-haiku-20241022',
          systemPrompt,
          temperature: 0.7,
        },
        voice: {
          provider: 'elevenlabs',
          voiceId: DEFAULT_VOICE_ID,
          model: 'eleven_turbo_v2_5',
          stability: 0.5,
          similarityBoost: 0.75,
        },
        firstMessage: `Hi, thank you for calling ${practice_name}! This is ${elliesName}. How can I help you today?`,
        endCallMessage: `Thank you for calling ${practice_name}. Have a wonderful day!`,
        silenceTimeoutSeconds: 30,
        maxDurationSeconds: 600,
        backgroundSound: 'off',
        backchannelingEnabled: false,
      }),
    })

    if (!vapiRes.ok) {
      const err = await vapiRes.text()
      console.error('Vapi assistant creation failed:', err)
      return NextResponse.json({ error: 'Failed to create Vapi assistant', details: err }, { status: 500 })
    }

    const vapiAssistant = await vapiRes.json()
    const vapiAssistantId = vapiAssistant.id
    console.log(`✓ Vapi assistant created: ${vapiAssistantId}`)

    // 2. Create the practice in Supabase
    const { data: practice, error: practiceError } = await supabaseAdmin
      .from('practices')
      .insert({
        name: practice_name,
        therapist_name,
        notification_email,
        phone_number: phone_number || null,
        ai_name: elliesName,
        vapi_assistant_id: vapiAssistantId,
        specialties: body.specialties || [],
        hours: body.hours || null,
        location: body.location || null,
        telehealth: body.telehealth ?? true,
        insurance_accepted: body.insurance_accepted || [],
        system_prompt: systemPrompt,
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (practiceError) {
      console.error('Error creating practice in DB:', practiceError)
      // Attempt to clean up the Vapi assistant we just created
      await fetch(`${VAPI_BASE_URL}/assistant/${vapiAssistantId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` },
      })
      return NextResponse.json({ error: 'Failed to create practice record' }, { status: 500 })
    }

    console.log(`✓ Practice created: ${practice.id} (${practice_name})`)

    return NextResponse.json({
      success: true,
      practice: {
        id: practice.id,
        name: practice.name,
        therapist_name: practice.therapist_name,
        vapi_assistant_id: vapiAssistantId,
        phone_number: practice.phone_number,
      },
      next_steps: [
        phone_number
          ? `Configure Twilio number ${phone_number} to forward to Vapi assistant ${vapiAssistantId}`
          : 'Purchase a Twilio number and configure it to forward to the Vapi assistant',
        `Set your Vapi webhook URL to: ${process.env.NEXT_PUBLIC_APP_URL}/api/vapi/webhook?practice_id=${practice.id}`,
        `Therapist will receive post-call summaries at: ${notification_email}`,
      ],
    }, { status: 201 })

  } catch (error) {
    console.error('Provision error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/provision',
    description: 'Provision a new therapist — creates Vapi assistant + practice record',
    required_fields: ['therapist_name', 'practice_name', 'notification_email'],
    optional_fields: ['phone_number', 'ai_name', 'specialties', 'hours', 'location', 'telehealth', 'insurance_accepted', 'system_prompt_notes'],
  })
}

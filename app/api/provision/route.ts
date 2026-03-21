// Multi-therapist provisioning
// POST /api/provision — create a new practice + Vapi assistant + (optionally) Twilio number
// Used when onboarding a new therapist to Harbor

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildSystemPrompt } from '@/lib/systemPrompt'

const VAPI_API_KEY = process.env.VAPI_API_KEY
const VAPI_BASE_URL = 'https://api.vapi.ai'

// ElevenLabs Bella voice — default for all Harbor assistants
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'

interface ProvisionRequest {
  // Practice / therapist info
  therapist_name: string
  practice_name: string
  notification_email: string
  phone_number?: string // Existing Twilio number (optional)
  therapist_phone?: string // Phone number for crisis alerts

  // Ellie persona customization
  ai_name?: string         // Default: "Ellie"
  specialties?: string[]
  hours?: string
  location?: string
  telehealth?: boolean
  insurance_accepted?: string[]
  system_prompt_notes?: string // Any extra instructions for this therapist's Ellie
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
        tools: [
          {
            type: 'function',
            function: {
              name: 'submitIntakeScreening',
              description: 'Submit intake screening scores after collecting PHQ-2 and GAD-2 responses',
              parameters: {
                type: 'object',
                properties: {
                  phq2_score: { type: 'number', description: 'PHQ-2 score (depression), 0-6' },
                  gad2_score: { type: 'number', description: 'GAD-2 score (anxiety), 0-6' },
                  phq2_flag: { type: 'boolean', description: 'Whether PHQ-2 score >= 3 (elevated depression)' },
                  gad2_flag: { type: 'boolean', description: 'Whether GAD-2 score >= 3 (elevated anxiety)' },
                  patient_phone: { type: 'string', description: 'Patient phone number for record linking' },
                },
                required: ['phq2_score', 'gad2_score'],
              },
            },
          },
        ],
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
        therapist_phone: body.therapist_phone || null,
        ai_name: elliesName,
        vapi_assistant_id: vapiAssistantId,
        specialties: body.specialties || [],
        hours: body.hours || null,
        location: body.location || null,
        telehealth: body.telehealth ?? true,
        emotional_support_enabled: true,
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

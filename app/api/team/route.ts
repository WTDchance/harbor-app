// GET /api/team — List practice members
// POST /api/team — Add new team member

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const VAPI_API_KEY = process.env.VAPI_API_KEY
const VAPI_BASE_URL = 'https://api.vapi.ai'
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const practice_id = searchParams.get('practice_id')

    if (!practice_id) {
      return NextResponse.json(
        { error: 'Missing practice_id parameter' },
        { status: 400 }
      )
    }

    // Fetch practice members
    const { data: members, error } = await supabaseAdmin
      .from('practice_members')
      .select('*')
      .eq('practice_id', practice_id)
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching members:', error)
      return NextResponse.json(
        { error: 'Failed to fetch members' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      members: members || [],
    })
  } catch (error) {
    console.error('Error in GET /api/team:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const { practice_id, therapist_name, therapist_email, therapist_phone, specialties } = await request.json()

    if (!practice_id || !therapist_name) {
      return NextResponse.json(
        { error: 'Missing required fields: practice_id, therapist_name' },
        { status: 400 }
      )
    }

    // Get practice details for Vapi assistant creation
    const { data: practice } = await supabaseAdmin
      .from('practices')
      .select('name, ai_name')
      .eq('id', practice_id)
      .single()

    if (!practice) {
      return NextResponse.json(
        { error: 'Practice not found' },
        { status: 404 }
      )
    }

    // Create Vapi assistant for this therapist
    let vapiAssistantId = null
    if (VAPI_API_KEY) {
      const systemPrompt = `You are ${therapist_name}, a receptionist for ${practice.name}. ${specialties ? `You specialize in: ${specialties.join(', ')}.` : ''} Answer calls warmly and professionally.`

      const vapiRes = await fetch(`${VAPI_BASE_URL}/assistant`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${VAPI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `${practice.ai_name} — ${practice.name} (${therapist_name})`,
          model: {
            provider: 'anthropic',
            model: 'claude-haiku-4-5-20251001',
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
          firstMessage: `Hi, thank you for calling ${practice.name}! This is ${therapist_name}'s assistant. How can I help you today?`,
          endCallMessage: `Thank you for calling ${practice.name}. Have a wonderful day!`,
          silenceTimeoutSeconds: 30,
          maxDurationSeconds: 600,
          backgroundSound: 'off',
          backchannelingEnabled: false,
        }),
      })

      if (vapiRes.ok) {
        const vapiAssistant = await vapiRes.json()
        vapiAssistantId = vapiAssistant.id
      }
    }

    // Create practice member record
    const { data: member, error } = await supabaseAdmin
      .from('practice_members')
      .insert({
        practice_id,
        therapist_name,
        therapist_email: therapist_email || null,
        therapist_phone: therapist_phone || null,
        vapi_assistant_id: vapiAssistantId,
        specialties: specialties || [],
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating member:', error)
      return NextResponse.json(
        { error: 'Failed to add team member' },
        { status: 500 }
      )
    }

    console.log(`✓ Team member added: ${therapist_name} for practice ${practice_id}`)

    return NextResponse.json({
      success: true,
      member: {
        id: member.id,
        therapist_name: member.therapist_name,
        vapi_assistant_id: vapiAssistantId,
      },
    })
  } catch (error) {
    console.error('Error in POST /api/team:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

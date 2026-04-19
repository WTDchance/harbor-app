import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolvePracticeIdForApi } from '@/lib/active-practice'

export async function GET(req: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's practice
    const practiceId = await resolvePracticeIdForApi(supabaseAdmin, user)
    if (!practiceId) {
      console.error('[Forwarding GET] No practice found for user')
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get practice forwarding settings
    const { data: practice, error: practiceError } = await supabaseAdmin
      .from('practices')
      .select('id, forwarding_enabled, call_forwarding_number')
      .eq('id', practiceId)
      .single()

    if (practiceError || !practice) {
      console.error('[Forwarding GET] Practice lookup error:', practiceError)
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    }

    console.log(`[Forwarding GET] Retrieved forwarding state for practice ${practice.id}`, {
      forwarding_enabled: practice.forwarding_enabled,
      has_forwarding_number: !!practice.call_forwarding_number,
    })

    return NextResponse.json(
      {
        forwarding_enabled: practice.forwarding_enabled || false,
        call_forwarding_number: practice.call_forwarding_number || null,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[Forwarding GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve forwarding settings' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse request body
    const { enabled, forwarding_number } = await req.json()

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 }
      )
    }

    // If enabling, forwarding_number is required
    if (enabled && !forwarding_number) {
      return NextResponse.json(
        { error: 'forwarding_number is required when enabling forwarding' },
        { status: 400 }
      )
    }

    // Get user's practice
    const practiceId = await resolvePracticeIdForApi(supabaseAdmin, user)
    if (!practiceId) {
      console.error('[Forwarding POST] No practice found for user')
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get practice with Twilio details
    const { data: practice, error: practiceError } = await supabaseAdmin
      .from('practices')
      .select('id, twilio_phone_sid, call_forwarding_number')
      .eq('id', practiceId)
      .single()

    if (practiceError || !practice) {
      console.error('[Forwarding POST] Practice lookup error:', practiceError)
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
    }

    if (!practice.twilio_phone_sid) {
      return NextResponse.json(
        { error: 'Practice does not have a Twilio phone number configured' },
        { status: 400 }
      )
    }

    // Initialize Twilio client
    const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)

    // Determine the voiceUrl based on enabled state
    let voiceUrl: string

    if (enabled) {
      voiceUrl = `https://harborreceptionist.com/api/twilio/forward?practice_id=${practice.id}`
    } else {
      voiceUrl = 'https://api.vapi.ai/twilio/inbound_call'
    }

    // Update Twilio phone number configuration
    try {
      await client.incomingPhoneNumbers(practice.twilio_phone_sid).update({
        voiceUrl,
      })
    } catch (twilioError) {
      console.error('[Forwarding POST] Twilio update error:', twilioError)
      return NextResponse.json(
        { error: 'Failed to update Twilio phone number configuration' },
        { status: 500 }
      )
    }

    // Update practice record in Supabase
    const updateData: Record<string, any> = {
      forwarding_enabled: enabled,
    }

    if (enabled && forwarding_number) {
      updateData.call_forwarding_number = forwarding_number
    }

    const { error: updateError } = await supabaseAdmin
      .from('practices')
      .update(updateData)
      .eq('id', practice.id)

    if (updateError) {
      console.error('[Forwarding POST] Supabase update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update practice forwarding settings' },
        { status: 500 }
      )
    }

    console.log(`[Forwarding POST] Updated forwarding for practice ${practice.id}`, {
      enabled,
      forwarding_number: enabled ? forwarding_number : null,
    })

    return NextResponse.json(
      {
        success: true,
        forwarding_enabled: enabled,
        call_forwarding_number: enabled ? forwarding_number : null,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[Forwarding POST] Error:', error)

    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'Failed to update forwarding settings' },
      { status: 500 }
    )
  }
  }

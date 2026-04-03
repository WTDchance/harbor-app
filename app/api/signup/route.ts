import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const VAPI_API_KEY = process.env.VAPI_API_KEY

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      practice_name, provider_name, phone, city, state,
      email, password, ai_name, greeting, timezone,
      telehealth, accepting_new_patients,
      specialties, insurance_accepted, hours_json,
    } = body

    if (!practice_name || !provider_name || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 1. Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError || !authData.user) {
      const msg = authError?.message || 'Failed to create account'
      if (msg.includes('already been registered')) {
        return NextResponse.json({ error: 'An account with this email already exists. Try signing in.' }, { status: 400 })
      }
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    const userId = authData.user.id
    const aiName = ai_name || 'Ellie'
    const ellieGreeting = greeting || `Thank you for calling ${practice_name}. This is ${aiName}, the AI receptionist for ${provider_name}. How can I help you today?`

    // 2. Build location string
    const location = [city, state].filter(Boolean).join(', ') || null

    // 3. Build hours_json if not provided
    const finalHoursJson = hours_json || {
      monday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      tuesday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      wednesday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      thursday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      friday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      saturday: { enabled: false, openTime: '09:00', closeTime: '13:00' },
      sunday: { enabled: false, openTime: '09:00', closeTime: '13:00' },
    }

    // 4. Provision Vapi assistant (non-fatal if it fails)
    let vapiAssistantId = null
    if (VAPI_API_KEY) {
      try {
        // Build a basic system prompt for the assistant
        const specialtiesStr = (specialties && specialties.length > 0) ? specialties.join(', ') : 'general therapy'
        const insuranceStr = (insurance_accepted && insurance_accepted.length > 0) ? insurance_accepted.join(', ') : 'various insurance plans'
        const telehealthStr = telehealth ? 'Yes, telehealth appointments are available.' : 'No, only in-person appointments.'

        const systemPrompt = `You are ${aiName}, the AI receptionist for ${practice_name}. ${provider_name} is the therapist. ` +
          `The practice is located in ${location || 'the local area'} and specializes in ${specialtiesStr}. ` +
          `Insurance accepted: ${insuranceStr}. Telehealth: ${telehealthStr}. ` +
          `Your role is to answer calls, help patients schedule appointments, collect basic information, and transfer to the provider when needed. ` +
          `Be warm, professional, and HIPAA-conscious. Never discuss specific patient medical details.`

        const vapiRes = await fetch('https://api.vapi.ai/assistant', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${VAPI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: `${practice_name} - ${aiName}`,
            model: {
              provider: 'anthropic',
              model: 'claude-3-5-haiku-20241022',
              messages: [{ role: 'system', content: systemPrompt }],
            },
            voice: { provider: '11labs', voiceId: 'sarah' },
            firstMessage: ellieGreeting,
            endCallFunctionEnabled: true,
            transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en-US' },
          }),
        })

        if (vapiRes.ok) {
          const vapiData = await vapiRes.json()
          vapiAssistantId = vapiData.id
          console.log(`Vapi assistant created: ${vapiData.id} for ${practice_name}`)
        } else {
          console.error('Vapi creation failed:', await vapiRes.text())
        }
      } catch (e) {
        console.error('Vapi provisioning failed (non-fatal):', e)
      }
    }

    // 5. Create practice record â linked to auth user
    const { data: practice, error: practiceError } = await supabaseAdmin
      .from('practices')
      .insert({
        name: practice_name,
        ai_name: aiName,
        phone_number: phone || null,
        location,
        specialties: specialties || [],
        telehealth: telehealth !== false,
        accepting_new_patients: accepting_new_patients !== false,
        hours_json: finalHoursJson,
        timezone: timezone || 'America/Los_Angeles',
        greeting: ellieGreeting,
        vapi_assistant_id: vapiAssistantId,
        auth_user_id: userId,
        notification_email: email,
        status: 'trial',
        reminders_enabled: true,
        intake_enabled: true,
        emotional_support_enabled: true,
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        insurance_accepted: insurance_accepted || [],
        provider_name,
        city: city || null,
        state: state || null,
        specialty: (specialties && specialties[0]) ? specialties[0].toLowerCase().replace(/\s+/g, '_') : 'general',
      })
      .select()
      .single()

    if (practiceError || !practice) {
      console.error('Practice creation failed:', practiceError)
      // Rollback: delete auth user
      await supabaseAdmin.auth.admin.deleteUser(userId)
      // Rollback: delete Vapi assistant
      if (vapiAssistantId && VAPI_API_KEY) {
        try {
          await fetch(`https://api.vapi.ai/assistant/${vapiAssistantId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
          })
        } catch {}
      }
      return NextResponse.json({ error: practiceError?.message || 'Failed to create practice' }, { status: 500 })
    }

    // 6. Create user record in users table (links auth user to practice)
    const { error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        id: userId,
        email,
        practice_id: practice.id,
        role: 'owner',
      })

    if (userError) {
      console.error('User record creation failed (non-fatal):', userError)
      // Non-fatal â practice is created, user can still access via auth_user_id on practices
    }

    console.log(`New practice created: ${practice_name} (${practice.id}) by ${email}`)

    return NextResponse.json({
      success: true,
      practice_id: practice.id,
      vapi_assistant_id: vapiAssistantId,
      message: 'Account created successfully',
    })
  } catch (error: any) {
    console.error('Signup error:', error)
    return NextResponse.json({ error: error.message || 'Signup failed' }, { status: 500 })
  }
}

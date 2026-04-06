import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const VAPI_API_KEY = process.env.VAPI_API_KEY
const VAPI_WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://harborreceptionist.com'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      practice_name, provider_name, phone, city, state,
      email, password, ai_name, greeting, timezone,
      telehealth, accepting_new_patients,
      specialties, insurance_accepted, hours_json,
      tos_accepted, baa_acknowledged,
    } = body

    // --- Basic validation ---
    if (!practice_name || !provider_name || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    if (!tos_accepted || !baa_acknowledged) {
      return NextResponse.json(
        { error: 'You must accept the Terms of Service and acknowledge the BAA to continue.' },
        { status: 400 }
      )
    }

    const normalizedEmail = String(email).trim().toLowerCase()
    const aiName = ai_name || 'Ellie'
    const ellieGreeting =
      greeting ||
      `Thank you for calling ${practice_name}. This is ${aiName}, the AI receptionist for ${provider_name}. How can I help you today?`
    const location = [city, state].filter(Boolean).join(', ') || null

    const finalHoursJson = hours_json || {
      monday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      tuesday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      wednesday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      thursday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      friday: { enabled: true, openTime: '09:00', closeTime: '17:00' },
      saturday: { enabled: false, openTime: '09:00', closeTime: '13:00' },
      sunday: { enabled: false, openTime: '09:00', closeTime: '13:00' },
    }

    // --- 1. Create auth user ---
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
    })

    if (authError || !authData.user) {
      const msg = authError?.message || 'Failed to create account'
      if (msg.toLowerCase().includes('already been registered') || msg.toLowerCase().includes('already registered')) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Try signing in.' },
          { status: 400 }
        )
      }
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    const userId = authData.user.id

    // --- 2. Create practice record FIRST (so we have a practice_id for Vapi metadata) ---
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
        vapi_assistant_id: null,
        auth_user_id: userId,
        notification_email: normalizedEmail,
        status: 'trial',
        reminders_enabled: true,
        intake_enabled: true,
        emotional_support_enabled: true,
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        insurance_accepted: insurance_accepted || [],
        provider_name,
        city: city || null,
        state: state || null,
        specialty:
          specialties && specialties[0]
            ? specialties[0].toLowerCase().replace(/\s+/g, '_')
            : 'general',
      })
      .select()
      .single()

    if (practiceError || !practice) {
      console.error('Practice creation failed:', practiceError)
      // Rollback: delete auth user
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return NextResponse.json(
        { error: practiceError?.message || 'Failed to create practice' },
        { status: 500 }
      )
    }

    // --- 3. Create user record in users table (links auth user to practice) ---
    const { error: userError } = await supabaseAdmin.from('users').insert({
      id: userId,
      email: normalizedEmail,
      practice_id: practice.id,
      role: 'owner',
    })

    if (userError) {
      console.error('User record creation failed (non-fatal):', userError)
    }

    // --- 4. Provision Vapi assistant with proper webhook wiring + metadata ---
    let vapiAssistantId: string | null = null
    if (VAPI_API_KEY) {
      try {
        const specialtiesStr =
          specialties && specialties.length > 0 ? specialties.join(', ') : 'general therapy'
        const insuranceStr =
          insurance_accepted && insurance_accepted.length > 0
            ? insurance_accepted.join(', ')
            : 'various insurance plans'
        const telehealthStr = telehealth
          ? 'Yes, telehealth appointments are available.'
          : 'No, only in-person appointments.'

        const systemPrompt =
          `You are ${aiName}, the AI receptionist for ${practice_name}. ${provider_name} is the therapist. ` +
          `The practice is located in ${location || 'the local area'} and specializes in ${specialtiesStr}. ` +
          `Insurance accepted: ${insuranceStr}. Telehealth: ${telehealthStr}. ` +
          `Your role is to answer calls, help patients schedule appointments, collect basic information, ` +
          `and transfer to the provider when needed. Be warm, professional, and HIPAA-conscious. ` +
          `Never discuss specific patient medical details. If a caller expresses suicidal thoughts, ` +
          `self-harm, or other crisis signals, provide the 988 Suicide & Crisis Lifeline immediately ` +
          `and keep them engaged until help is available.`

        // Build Vapi server URL with the shared webhook secret so the
        // existing /api/vapi/webhook handler can authenticate the callback.
        const serverUrl = VAPI_WEBHOOK_SECRET
          ? `${APP_URL}/api/vapi/webhook?secret=${encodeURIComponent(VAPI_WEBHOOK_SECRET)}`
          : `${APP_URL}/api/vapi/webhook`

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
            // CRITICAL: these two fields make Vapi post end-of-call reports
            // back to Harbor's webhook AND let the handler identify the practice.
            server: { url: serverUrl },
            metadata: {
              practiceId: practice.id,
              practiceName: practice_name,
              providerName: provider_name,
            },
          }),
        })

        if (vapiRes.ok) {
          const vapiData = await vapiRes.json()
          vapiAssistantId = vapiData.id
          console.log(
            `Vapi assistant created: ${vapiData.id} for ${practice_name} (${practice.id})`
          )

          // Update practice with the assistant id
          await supabaseAdmin
            .from('practices')
            .update({ vapi_assistant_id: vapiAssistantId })
            .eq('id', practice.id)
        } else {
          const errText = await vapiRes.text()
          console.error('Vapi creation failed:', errText)
          // Non-fatal: the practice exists, the owner can retry Vapi provisioning
          // from the dashboard. We don't rollback the practice here.
        }
      } catch (e) {
        console.error('Vapi provisioning failed (non-fatal):', e)
      }
    }

    console.log(`New practice created: ${practice_name} (${practice.id}) by ${normalizedEmail}`)

    return NextResponse.json({
      success: true,
      practice_id: practice.id,
      vapi_assistant_id: vapiAssistantId,
      vapi_provisioned: !!vapiAssistantId,
      message: 'Account created successfully',
    })
  } catch (error: any) {
    console.error('Signup error:', error)
    return NextResponse.json({ error: error.message || 'Signup failed' }, { status: 500 })
  }
}

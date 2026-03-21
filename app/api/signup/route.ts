import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildSystemPrompt } from '@/lib/systemPrompt'

const VAPI_API_KEY = process.env.VAPI_API_KEY || 'fe9a5a27-57b7-431e-bdc0-ff3ac083cd33'

export async function POST(req: NextRequest) {
    try {
          const body = await req.json()
          const {
                  practice_name, provider_name, phone, city, state, specialty,
                  email, password, greeting, timezone,
                  office_hours_start, office_hours_end,
                } = body

          if (!practice_name || !provider_name || !email || !password) {
                  return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
                }

          const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
                  email,
                  password,
                  email_confirm: false,
                })

          if (authError || !authData.user) {
                  return NextResponse.json({ error: authError?.message || 'Failed to create account' }, { status: 500 })
                }

          const ellieGreeting = greeting || `Thank you for calling ${practice_name}. This is Ellie, the AI assistant for ${provider_name}. How can I help you today?`

          const systemPrompt = buildSystemPrompt({
                  name: practice_name,
                  provider_name,
                  phone,
                  city,
                  state,
                  office_hours_start: office_hours_start || '09:00',
                  office_hours_end: office_hours_end || '17:00',
                  timezone: timezone || 'America/New_York',
                  greeting: ellieGreeting,
                  telehealth_available: false,
                  emotional_support_enabled: true,
                } as any)

          let vapiAssistantId = null
          try {
                  const vapiRes = await fetch('https://api.vapi.ai/assistant', {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${VAPI_API_KEY}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                        name: `${practice_name} - Ellie`,
                                        model: {
                                                      provider: 'anthropic',
                                                      model: 'claude-haiku-20240307',
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
                          }
                } catch (e) {
                  console.error('Vapi provisioning failed (non-fatal):', e)
                }

          const { data: practice, error: practiceError } = await supabaseAdmin
            .from('practices')
            .insert({
                      name: practice_name,
                      provider_name,
                      phone,
                      city,
                      state,
                      specialty: specialty || 'general',
                      notification_email: email,
                      timezone: timezone || 'America/New_York',
                      office_hours_start: office_hours_start || '09:00',
                      office_hours_end: office_hours_end || '17:00',
                      greeting: ellieGreeting,
                      vapi_assistant_id: vapiAssistantId,
                      emotional_support_enabled: true,
                      reminders_enabled: true,
                      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                      status: 'trial',
                    })
            .select()
            .single()

          if (practiceError || !practice) {
                  await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
                  return NextResponse.json({ error: practiceError?.message || 'Failed to create practice' }, { status: 500 })
                }

          return NextResponse.json({ success: true, practice_id: practice.id, message: 'Account created successfully' })
        } catch (error: any) {
          console.error('Signup error:', error)
          return NextResponse.json({ error: error.message || 'Signup failed' }, { status: 500 })
        }
  }

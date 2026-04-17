// Update practice settings and sync with Vapi assistant
// PATCH /api/practices/[id]

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase-server'
import { buildSystemPrompt } from '@/lib/systemPrompt'

const VAPI_API_KEY = process.env.VAPI_API_KEY
const VAPI_BASE_URL = 'https://api.vapi.ai'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
    try {
          const body = await request.json()
          const { id } = params

      // Auth check: require a valid session
      const supabase = await createServerSupabase()
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) {
                  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
          }

      // Fetch current practice
      const { data: practice, error: fetchError } = await supabaseAdmin
            .from('practices')
            .select('*')
            .eq('id', id)
            .single()

      if (fetchError || !practice) {
              return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
      }

      // Verify ownership: user must own this practice or be admin
      const isAdmin = user.email === process.env.ADMIN_EMAIL
          if (!isAdmin && practice.notification_email !== user.email) {
                  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
          }

      // Merge updates
      const updatedData = {
              ...practice,
              ...body,
              emotional_support_enabled: body.emotional_support_enabled ?? practice.emotional_support_enabled ?? true,
      }

      // Rebuild system prompt
      const newSystemPrompt = buildSystemPrompt(updatedData)

      // Update Supabase
      const { error: updateError } = await supabaseAdmin
            .from('practices')
            .update({
                      ...body,
                      system_prompt: newSystemPrompt,
            })
            .eq('id', id)

      if (updateError) {
              return NextResponse.json({ error: 'Failed to update practice' }, { status: 500 })
      }

      // Sync to Vapi if assistant exists
      if (practice.vapi_assistant_id && VAPI_API_KEY) {
              const vapiRes = await fetch(`${VAPI_BASE_URL}/assistant/${practice.vapi_assistant_id}`, {
                        method: 'PATCH',
                        headers: {
                                    'Authorization': `Bearer ${VAPI_API_KEY}`,
                                    'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                                    model: {
                                                  provider: 'anthropic',
                                                  model: 'claude-haiku-4-5-20251001',
                                                  systemPrompt: newSystemPrompt,
                                                  temperature: 0.7,
                                    },
                        }),
              })

            if (!vapiRes.ok) {
                      console.error('Vapi sync failed:', await vapiRes.text())
                      // Don't fail the whole request — DB update succeeded
            }
      }

      return NextResponse.json({ success: true })
    } catch (error) {
          console.error('Practice update error:', error)
          return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

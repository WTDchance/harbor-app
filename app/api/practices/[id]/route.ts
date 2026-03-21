// Update practice settings and sync with Vapi assistant
// PATCH /api/practices/[id]

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { buildSystemPrompt } from '@/lib/systemPrompt'

const VAPI_API_KEY = process.env.VAPI_API_KEY
const VAPI_BASE_URL = 'https://api.vapi.ai'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json()
    const { id } = params

    // Fetch current practice
    const { data: practice, error: fetchError } = await supabaseAdmin
      .from('practices')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !practice) {
      return NextResponse.json({ error: 'Practice not found' }, { status: 404 })
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
            model: 'claude-3-5-haiku-20241022',
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

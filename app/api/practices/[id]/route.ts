// Update practice settings and sync with Vapi assistant
// PATCH /api/practices/[id]

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase-server'
import { buildSystemPrompt } from '@/lib/systemPrompt'

const VAPI_API_KEY = process.env.VAPI_API_KEY
const VAPI_BASE_URL = 'https://api.vapi.ai'

/**
 * Convert hours_json (structured) to a human-readable string for the system prompt.
 */
function formatHoursForPrompt(hoursJson: any): string {
  if (!hoursJson) return 'Monday through Friday, 9am to 5pm'
  if (typeof hoursJson === 'string') return hoursJson

  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  const dayLabels: Record<string, string> = {
    monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
    thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
  }

  const parts: string[] = []
  for (const day of dayNames) {
    const h = hoursJson[day]
    if (!h) continue
    // Handle structured format: { enabled, openTime, closeTime }
    if (typeof h === 'object' && 'enabled' in h) {
      if (h.enabled && h.openTime && h.closeTime) {
        const open = formatTime(h.openTime)
        const close = formatTime(h.closeTime)
        parts.push(`${dayLabels[day]}: ${open} - ${close}`)
      }
    } else if (typeof h === 'string' && h !== 'closed') {
      parts.push(`${dayLabels[day]}: ${h}`)
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'Monday through Friday, 9am to 5pm'
}

function formatTime(t: string): string {
  // Convert "09:00" -> "9:00 AM", "17:00" -> "5:00 PM"
  const [hh, mm] = t.split(':').map(Number)
  if (isNaN(hh)) return t
  const suffix = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return mm === 0 ? `${h12} ${suffix}` : `${h12}:${mm.toString().padStart(2, '0')} ${suffix}`
}

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

    // Build hours string from hours_json for the system prompt
    const hoursString = formatHoursForPrompt(updatedData.hours_json)

    // Fetch active therapists so the system prompt can include their bios.
    const { data: therapistRows } = await supabaseAdmin
      .from('therapists')
      .select('display_name, credentials, bio, is_primary, is_active')
      .eq('practice_id', id)
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })

    // Rebuild system prompt with proper hours
    const newSystemPrompt = buildSystemPrompt({
      ...updatedData,
      hours: hoursString,
      fax_number: updatedData.fax_number || null,
      therapists: (therapistRows || []).map(t => ({
        display_name: t.display_name,
        credentials: t.credentials,
        bio: t.bio,
      })),
    })

    // Update Supabase
    const { error: updateError } = await supabaseAdmin
      .from('practices')
      .update({
        ...body,
        system_prompt: newSystemPrompt,
      })
      .eq('id', id)

    if (updateError) {
      console.error('Practice update error:', updateError)
      return NextResponse.json({ error: 'Failed to update practice' }, { status: 500 })
    }

    // Sync to Vapi if assistant exists
    if (practice.vapi_assistant_id && VAPI_API_KEY) {
      const vapiPatch: Record<string, any> = {
        model: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          messages: [{ role: 'system', content: newSystemPrompt }],
          temperature: 0.7,
        },
      }

      // Sync greeting as firstMessage if it was updated
      if (body.greeting !== undefined) {
        vapiPatch.firstMessage = body.greeting || practice.greeting
      }

      // Sync name if ai_name or practice name changed
      if (body.ai_name !== undefined || body.name !== undefined) {
        const aiName = updatedData.ai_name || 'Ellie'
        const practiceName = updatedData.name || practice.name
        vapiPatch.name = `${aiName} - ${practiceName}`
      }

      const vapiRes = await fetch(`${VAPI_BASE_URL}/assistant/${practice.vapi_assistant_id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${VAPI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(vapiPatch),
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

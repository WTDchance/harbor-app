// GET /api/team — List practice members
// POST /api/team — Add new team member

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

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

    // Wave 41 — Vapi retired. Per-therapist AI assistants are not yet
    // ported to Retell; the practice's primary Retell agent (provisioned
    // by lib/aws/provisioning/provision-practice) handles all inbound
    // calls. New team members are recorded without their own assistant
    // until the per-therapist Retell agent feature ships.
    const vapiAssistantId: string | null = null

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

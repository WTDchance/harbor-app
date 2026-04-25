// Waitlist patient management
// PATCH /api/waitlist/[id] — update priority or status
// DELETE /api/waitlist/[id] — remove from waitlist

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const body = await request.json()

    const allowedFields = ['priority', 'status', 'notes', 'fill_offered_at', 'offered_slot']
    const updates: Record<string, string> = {}

    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field]
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data: patient, error } = await supabaseAdmin
      .from('waitlist')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating waitlist patient:', error)
      return NextResponse.json({ error: 'Failed to update patient' }, { status: 500 })
    }

    return NextResponse.json({ patient })
  } catch (error) {
    console.error('Waitlist PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    const { error } = await supabaseAdmin
      .from('waitlist')
      .update({ status: 'removed' })
      .eq('id', id)

    if (error) {
      console.error('Error removing waitlist patient:', error)
      return NextResponse.json({ error: 'Failed to remove patient' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Waitlist DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

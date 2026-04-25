// Confirm or revert a pending schedule change
// POST /api/schedule-changes/[id]/confirm
// Body: { action: 'confirm' | 'revert' }

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createServerSupabase } from '@/lib/supabase-server'
import { resolvePracticeIdForApi } from '@/lib/active-practice'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createServerSupabase()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const practiceId = await resolvePracticeIdForApi(supabaseAdmin, user)
    if (!practiceId) {
      return NextResponse.json({ error: 'No practice found' }, { status: 403 })
    }

    const { id } = params
    const body = await req.json()
    const { action } = body

    if (!action || !['confirm', 'revert'].includes(action)) {
      return NextResponse.json({ error: 'action must be "confirm" or "revert"' }, { status: 400 })
    }

    // Fetch the change
    const { data: change, error: fetchError } = await supabaseAdmin
      .from('schedule_changes')
      .select('*')
      .eq('id', id)
      .eq('practice_id', practiceId)
      .single()

    if (fetchError || !change) {
      return NextResponse.json({ error: 'Change not found' }, { status: 404 })
    }

    if (change.status !== 'pending') {
      return NextResponse.json({ error: `Change is already ${change.status}` }, { status: 400 })
    }

    if (action === 'confirm') {
      // Update the schedule change status
      await supabaseAdmin
        .from('schedule_changes')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('id', id)

      // Update the actual appointment if it's a reschedule
      if (change.change_type === 'rescheduled' && change.appointment_id && change.new_time) {
        await supabaseAdmin
          .from('appointments')
          .update({ scheduled_at: change.new_time })
          .eq('id', change.appointment_id)
      }

      // If it's a cancellation, update appointment status
      if (change.change_type === 'cancelled' && change.appointment_id) {
        await supabaseAdmin
          .from('appointments')
          .update({ status: 'cancelled' })
          .eq('id', change.appointment_id)
      }

      return NextResponse.json({ success: true, status: 'confirmed' })
    } else {
      // Revert — just mark as reverted, no appointment changes
      await supabaseAdmin
        .from('schedule_changes')
        .update({ status: 'reverted' })
        .eq('id', id)

      // TODO: Notify patient that the change was not approved

      return NextResponse.json({ success: true, status: 'reverted' })
    }
  } catch (err) {
    console.error('[schedule-changes/confirm POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

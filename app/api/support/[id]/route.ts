import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireApiSession } from '@/lib/aws/api-auth'

// GET /api/support/[id] — get a single ticket
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const __ctx = await requireApiSession();
    if (__ctx instanceof NextResponse) return __ctx;
    const session = { user: { id: __ctx.user.id, email: __ctx.session.email } } as any;
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('practice_id, role')
      .eq('id', session.user.id)
      .single()

    if (!user?.practice_id) {
      return NextResponse.json({ error: 'No practice found' }, { status: 404 })
    }

    let query = supabaseAdmin
      .from('support_tickets')
      .select('*')
      .eq('id', params.id)
      .single()

    // Non-admin users can only see their own practice's tickets
    if (user.role !== 'admin') {
      query = query.eq('practice_id', user.practice_id)
    }

    const { data: ticket, error } = await query

    if (error || !ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    return NextResponse.json({ ticket })
  } catch (err) {
    console.error('Support GET [id] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// PATCH /api/support/[id] — update a ticket (status, dev_notes, resolution, assigned_to)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const __ctx = await requireApiSession();
    if (__ctx instanceof NextResponse) return __ctx;
    const session = { user: { id: __ctx.user.id, email: __ctx.session.email } } as any;
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('practice_id, role')
      .eq('id', session.user.id)
      .single()

    if (!user?.practice_id) {
      return NextResponse.json({ error: 'No practice found' }, { status: 404 })
    }

    const body = await request.json()
    const allowedFields: Record<string, boolean> = {
      status: true,
      priority: true,
      dev_notes: true,
      resolution: true,
      assigned_to: true,
    }

    // Practice users can only update status (to close their own tickets)
    // Admin users can update all fields
    const updates: Record<string, any> = {}
    for (const [key, value] of Object.entries(body)) {
      if (allowedFields[key]) {
        if (user.role !== 'admin' && key !== 'status') continue
        updates[key] = value
      }
    }

    if (updates.status === 'resolved' || updates.status === 'closed') {
      updates.resolved_at = new Date().toISOString()
    }
    updates.updated_at = new Date().toISOString()

    let query = supabaseAdmin
      .from('support_tickets')
      .update(updates)
      .eq('id', params.id)

    // Non-admin can only update their own practice's tickets
    if (user.role !== 'admin') {
      query = query.eq('practice_id', user.practice_id)
    }

    const { data: ticket, error } = await query.select().single()

    if (error) {
      console.error('Error updating support ticket:', error)
      return NextResponse.json({ error: 'Failed to update ticket' }, { status: 500 })
    }

    return NextResponse.json({ ticket })
  } catch (err) {
    console.error('Support PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

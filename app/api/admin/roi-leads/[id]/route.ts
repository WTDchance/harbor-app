// app/api/admin/roi-leads/[id]/route.ts
// Admin-only: update a single ROI lead's stage, notes, next action.
// PATCH /api/admin/roi-leads/[id]

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireApiSession } from '@/lib/aws/api-auth'

const STAGES = ['new', 'contacted', 'demo_booked', 'proposal_sent', 'won', 'lost', 'unresponsive'] as const

async function requireAdmin() {
  const supabase = await createClient()
  const __ctx = await requireApiSession();
  if (__ctx instanceof NextResponse) return __ctx;
  const user = { id: __ctx.user.id, email: __ctx.session.email };
  if (!user) return { user: null, error: 'Unauthorized' as const, status: 401 }
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail || user.email !== adminEmail) {
    return { user: null, error: 'Forbidden — admin only' as const, status: 403 }
  }
  return { user, error: null, status: 200 }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin()
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, any> = {}

  if (typeof body.stage === 'string') {
    if (!STAGES.includes(body.stage as any)) {
      return NextResponse.json({ error: `Invalid stage. Must be one of: ${STAGES.join(', ')}` }, { status: 400 })
    }
    updates.stage = body.stage
    // Auto-stamp contacted_at the first time we move past 'new'.
    if (body.stage !== 'new') {
      const { data: existing } = await supabaseAdmin
        .from('roi_calculator_submissions')
        .select('contacted_at')
        .eq('id', params.id)
        .maybeSingle()
      if (existing && !existing.contacted_at) {
        updates.contacted_at = new Date().toISOString()
        updates.contacted_by = auth.user?.email || null
      }
    }
  }
  if ('notes' in body) {
    updates.notes = typeof body.notes === 'string' ? body.notes : null
  }
  if ('next_action_at' in body) {
    updates.next_action_at = body.next_action_at || null
  }
  if ('converted_practice_id' in body) {
    updates.converted_practice_id = body.converted_practice_id || null
    if (body.converted_practice_id) {
      updates.stage = 'won'
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('roi_calculator_submissions')
    .update(updates)
    .eq('id', params.id)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ lead: data })
}

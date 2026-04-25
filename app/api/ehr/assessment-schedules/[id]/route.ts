// app/api/ehr/assessment-schedules/[id]/route.ts — stop or resume a schedule.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params
  const body = await req.json().catch(() => null)
  const patch: any = {}
  if (typeof body?.is_active === 'boolean') patch.is_active = body.is_active
  if (Number.isInteger(body?.cadence_weeks)) patch.cadence_weeks = body.cadence_weeks
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('ehr_assessment_schedules').update(patch).eq('id', id).eq('practice_id', auth.practiceId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ schedule: data })
}

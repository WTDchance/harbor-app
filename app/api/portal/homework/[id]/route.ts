// app/api/portal/homework/[id]/route.ts — patient marks homework complete.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getPortalSession } from '@/lib/ehr/portal'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getPortalSession(); if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => null)
  const action = body?.action
  const note = typeof body?.completion_note === 'string' ? body.completion_note.slice(0, 500) : null

  if (action !== 'complete' && action !== 'skip' && action !== 'reopen') {
    return NextResponse.json({ error: 'action must be complete | skip | reopen' }, { status: 400 })
  }

  // Verify ownership
  const { data: hw } = await supabaseAdmin
    .from('ehr_homework').select('patient_id, practice_id').eq('id', id).maybeSingle()
  if (!hw || hw.patient_id !== s.patient_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const patch: any = action === 'complete'
    ? { status: 'completed', completed_at: new Date().toISOString(), completion_note: note }
    : action === 'skip'
    ? { status: 'skipped', completed_at: new Date().toISOString(), completion_note: note }
    : { status: 'assigned', completed_at: null, completion_note: null }

  const { data, error } = await supabaseAdmin
    .from('ehr_homework').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await auditEhrAccess({
    user: { id: '00000000-0000-0000-0000-000000000000', email: `portal:${s.patient_id}` },
    practiceId: hw.practice_id, action: 'note.update',
    resourceId: id, details: { kind: 'homework', action, via: 'portal' },
  })
  return NextResponse.json({ homework: data })
}

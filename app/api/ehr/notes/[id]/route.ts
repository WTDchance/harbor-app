// app/api/ehr/notes/[id]/route.ts
// Harbor EHR — read, update, delete a single progress note.
// Signed notes are immutable; PATCH on a signed note returns 409.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

const UPDATABLE_FIELDS = new Set([
  'title',
  'note_format',
  'subjective',
  'objective',
  'assessment',
  'plan',
  'body',
  'appointment_id',
  'therapist_id',
  'cpt_codes',
  'icd10_codes',
  'linked_goal_ids',
])

async function loadNote(noteId: string, practiceId: string) {
  const { data } = await supabaseAdmin
    .from('ehr_progress_notes')
    .select('*')
    .eq('id', noteId)
    .eq('practice_id', practiceId)
    .maybeSingle()
  return data
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const note = await loadNote(id, auth.practiceId)
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await auditEhrAccess({
    user: auth.user,
    practiceId: auth.practiceId,
    action: 'note.view',
    resourceId: id,
  })
  return NextResponse.json({ note })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const existing = await loadNote(id, auth.practiceId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'signed' || existing.status === 'amended') {
    return NextResponse.json(
      { error: 'Signed notes are immutable. Create an amendment instead.' },
      { status: 409 },
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Record<string, any> = {}
  for (const [k, v] of Object.entries(body)) {
    if (UPDATABLE_FIELDS.has(k)) patch[k] = v
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('ehr_progress_notes')
    .update(patch)
    .eq('id', id)
    .eq('practice_id', auth.practiceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user,
    practiceId: auth.practiceId,
    action: 'note.update',
    resourceId: id,
    details: { fields: Object.keys(patch) },
  })
  return NextResponse.json({ note: data })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const existing = await loadNote(id, auth.practiceId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.status !== 'draft') {
    return NextResponse.json(
      { error: 'Only draft notes can be deleted. Signed notes stay for audit.' },
      { status: 409 },
    )
  }

  const { error } = await supabaseAdmin
    .from('ehr_progress_notes')
    .delete()
    .eq('id', id)
    .eq('practice_id', auth.practiceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditEhrAccess({
    user: auth.user,
    practiceId: auth.practiceId,
    action: 'note.delete',
    resourceId: id,
    severity: 'warn',
  })
  return NextResponse.json({ success: true })
}

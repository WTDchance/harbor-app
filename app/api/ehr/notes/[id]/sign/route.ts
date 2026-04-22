// app/api/ehr/notes/[id]/sign/route.ts
// Harbor EHR — sign a progress note. Once signed, the note is locked.

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'

function contentHash(note: Record<string, any>): string {
  // Hash the fields that make up the clinical content, in a stable order.
  const parts = [
    note.title || '',
    note.note_format || '',
    note.subjective || '',
    note.objective || '',
    note.assessment || '',
    note.plan || '',
    note.body || '',
    (note.cpt_codes || []).join(','),
    (note.icd10_codes || []).join(','),
  ]
  return createHash('sha256').update(parts.join('\u241E')).digest('hex')
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const { data: note } = await supabaseAdmin
    .from('ehr_progress_notes')
    .select('*')
    .eq('id', id)
    .eq('practice_id', auth.practiceId)
    .maybeSingle()

  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (note.status !== 'draft') {
    return NextResponse.json(
      { error: `Cannot sign a note in status "${note.status}".` },
      { status: 409 },
    )
  }

  // Basic content check — a signed note should have actual content.
  const hasStructured = note.subjective || note.objective || note.assessment || note.plan
  const hasBody = typeof note.body === 'string' && note.body.trim().length > 0
  if (!hasStructured && !hasBody) {
    return NextResponse.json(
      { error: 'Cannot sign an empty note. Add content in at least one section.' },
      { status: 400 },
    )
  }

  const hash = contentHash(note)
  const { data, error } = await supabaseAdmin
    .from('ehr_progress_notes')
    .update({
      status: 'signed',
      signed_at: new Date().toISOString(),
      signed_by: auth.user.id,
      signature_hash: hash,
    })
    .eq('id', id)
    .eq('practice_id', auth.practiceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ note: data, success: true })
}

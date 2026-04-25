// app/api/ehr/notes/[id]/cosign/route.ts
// Supervisor co-signs a signed note. Does NOT change status (note stays
// 'signed' or 'amended'); stamps cosigned_at + cosigned_by + a hash of
// the note content at cosign time. Supervisor authority is validated via
// the ehr_supervision table.

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

function contentHash(n: any): string {
  const parts = [
    n.title || '', n.note_format || '', n.subjective || '', n.objective || '',
    n.assessment || '', n.plan || '', n.body || '',
    (n.cpt_codes || []).join(','), (n.icd10_codes || []).join(','),
  ]
  return createHash('sha256').update(parts.join('\u241E')).digest('hex')
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEhrAuth(); if (isAuthError(auth)) return auth
  const { id } = await params

  const { data: note } = await supabaseAdmin
    .from('ehr_progress_notes').select('*').eq('id', id).eq('practice_id', auth.practiceId).maybeSingle()
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!note.requires_cosign) {
    return NextResponse.json({ error: 'This note does not require co-sign' }, { status: 409 })
  }
  if (note.cosigned_at) {
    return NextResponse.json({ error: 'Already co-signed' }, { status: 409 })
  }
  if (note.status !== 'signed' && note.status !== 'amended') {
    return NextResponse.json({ error: 'Note must be signed before co-sign' }, { status: 409 })
  }

  // Authority check: is the caller listed as a supervisor of the note's
  // signing therapist? We map signed_by (auth.users.id) -> therapist row,
  // then verify ehr_supervision has an active entry with supervisor_id
  // matching the caller's therapist row. If the practice hasn't set up
  // therapist rows for its clinicians, fall back to allow if the caller
  // is an admin.
  const { data: callerTherapist } = await supabaseAdmin
    .from('therapists').select('id').eq('auth_user_id', auth.user.id).eq('practice_id', auth.practiceId).maybeSingle()

  let authorized = false
  if (callerTherapist && note.signed_by) {
    const { data: supervisee } = await supabaseAdmin
      .from('therapists').select('id').eq('auth_user_id', note.signed_by).eq('practice_id', auth.practiceId).maybeSingle()
    if (supervisee) {
      const { data: sup } = await supabaseAdmin
        .from('ehr_supervision').select('id').eq('practice_id', auth.practiceId)
        .eq('supervisor_id', callerTherapist.id).eq('supervisee_id', supervisee.id)
        .eq('is_active', true).maybeSingle()
      if (sup) authorized = true
    }
  }
  // Fall-through: admin override — allow the practice admin to cosign.
  if (!authorized && auth.user.email && auth.user.email.toLowerCase() === (process.env.ADMIN_EMAIL || 'chancewonser@gmail.com').toLowerCase()) {
    authorized = true
  }
  if (!authorized) {
    return NextResponse.json({ error: 'Not authorized to co-sign this note' }, { status: 403 })
  }

  const hash = contentHash(note)
  const { data, error } = await supabaseAdmin
    .from('ehr_progress_notes')
    .update({ cosigned_at: new Date().toISOString(), cosigned_by: auth.user.id, cosign_hash: hash })
    .eq('id', id).eq('practice_id', auth.practiceId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await auditEhrAccess({
    user: auth.user, practiceId: auth.practiceId, action: 'note.sign',
    resourceId: id, details: { kind: 'cosign', signed_by: note.signed_by, hash },
  })

  return NextResponse.json({ note: data, success: true })
}

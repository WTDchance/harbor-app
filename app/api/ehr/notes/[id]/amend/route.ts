// app/api/ehr/notes/[id]/amend/route.ts
// Harbor EHR — create an amendment to a signed note.
//
// Starts a fresh DRAFT row that copies the signed note's content and
// links back via amendment_of. The therapist edits the amendment and
// signs it normally (sign route sets status='amended' for amendments).
// The original note stays signed and immutable.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireEhrAuth, isAuthError } from '@/lib/ehr/auth'
import { auditEhrAccess } from '@/lib/ehr/audit'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEhrAuth()
  if (isAuthError(auth)) return auth
  const { id } = await params

  const { data: original } = await supabaseAdmin
    .from('ehr_progress_notes')
    .select('*')
    .eq('id', id)
    .eq('practice_id', auth.practiceId)
    .maybeSingle()

  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (original.status !== 'signed' && original.status !== 'amended') {
    return NextResponse.json(
      { error: 'Only signed notes can be amended. Edit drafts directly.' },
      { status: 409 },
    )
  }

  // Copy content into a fresh draft linked back to the original.
  const { data: amendment, error } = await supabaseAdmin
    .from('ehr_progress_notes')
    .insert({
      practice_id: auth.practiceId,
      patient_id: original.patient_id,
      appointment_id: original.appointment_id,
      therapist_id: original.therapist_id,
      title: `Amendment to: ${original.title}`,
      note_format: original.note_format,
      subjective: original.subjective,
      objective: original.objective,
      assessment: original.assessment,
      plan: original.plan,
      body: original.body,
      cpt_codes: original.cpt_codes,
      icd10_codes: original.icd10_codes,
      status: 'draft',
      amendment_of: original.id,
      created_by: auth.user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await auditEhrAccess({
    user: auth.user,
    practiceId: auth.practiceId,
    action: 'note.amend',
    resourceId: amendment.id,
    details: { amendment_of: original.id, title: amendment.title },
  })

  return NextResponse.json({ note: amendment }, { status: 201 })
}

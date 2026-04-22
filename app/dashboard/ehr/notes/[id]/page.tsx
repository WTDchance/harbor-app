// app/dashboard/ehr/notes/[id]/page.tsx
// Detail view for a single progress note. Two modes:
//   - draft: show editable form + Sign button
//   - signed/amended: show read-only view with signed metadata

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { ChevronLeft, GitBranch } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { NoteEditor, type NoteFormValue } from '@/components/ehr/NoteEditor'
import { SignButton } from './SignButton'
import { AmendButton } from './AmendButton'

export const dynamic = 'force-dynamic'

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }: any) => {
              cookieStore.set(name, value, options)
            })
          } catch {}
        },
      },
    },
  )
  const { data: { user } } = await supabase.auth.getUser()
  const practiceId = await getEffectivePracticeId(supabaseAdmin, user)

  const { data: note } = await supabaseAdmin
    .from('ehr_progress_notes')
    .select('*')
    .eq('id', id)
    .eq('practice_id', practiceId!)
    .maybeSingle()

  if (!note) return notFound()

  const { data: patients = [] } = await supabaseAdmin
    .from('patients')
    .select('id, first_name, last_name')
    .eq('practice_id', practiceId!)
    .order('last_name', { ascending: true })

  const initial: NoteFormValue = {
    id: note.id,
    patient_id: note.patient_id,
    title: note.title,
    note_format: note.note_format,
    subjective: note.subjective,
    objective: note.objective,
    assessment: note.assessment,
    plan: note.plan,
    body: note.body,
    cpt_codes: note.cpt_codes,
    icd10_codes: note.icd10_codes,
    status: note.status,
  }

  const isDraft = note.status === 'draft'
  const isSigned = note.status === 'signed' || note.status === 'amended'

  // Lineage — if this note amends another, or has amendments pointing at it.
  let parent: { id: string; title: string; signed_at: string | null } | null = null
  if (note.amendment_of) {
    const { data } = await supabaseAdmin
      .from('ehr_progress_notes')
      .select('id, title, signed_at')
      .eq('id', note.amendment_of)
      .eq('practice_id', practiceId!)
      .maybeSingle()
    if (data) parent = data
  }
  const { data: childAmendments = [] } = await supabaseAdmin
    .from('ehr_progress_notes')
    .select('id, title, status, created_at, signed_at')
    .eq('amendment_of', note.id)
    .eq('practice_id', practiceId!)
    .order('created_at', { ascending: true })

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Link
        href="/dashboard/ehr/notes"
        className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to notes
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-900">{note.title}</h1>
          <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide">
            {note.note_format} · {note.status}
            {note.signed_at && (
              <> · signed {new Date(note.signed_at).toLocaleString()}</>
            )}
          </div>
        </div>
        {isDraft && <SignButton noteId={note.id} />}
        {isSigned && <AmendButton noteId={note.id} />}
      </div>

      {/* Lineage banner — shown above the editor when this note is part of a chain */}
      {(parent || (childAmendments && childAmendments.length > 0)) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 text-sm">
          <div className="flex items-center gap-2 text-blue-800 font-medium mb-2">
            <GitBranch className="w-4 h-4" />
            Note lineage
          </div>
          {parent && (
            <div className="text-blue-800">
              Amends:{' '}
              <Link href={`/dashboard/ehr/notes/${parent.id}`} className="underline hover:text-blue-900">
                {parent.title}
              </Link>
              {parent.signed_at && (
                <span className="text-blue-600 text-xs ml-1">
                  (signed {new Date(parent.signed_at).toLocaleDateString()})
                </span>
              )}
            </div>
          )}
          {childAmendments && childAmendments.length > 0 && (
            <div className="text-blue-800 mt-1">
              This note has {childAmendments.length} amendment{childAmendments.length === 1 ? '' : 's'}:
              <ul className="mt-1 space-y-0.5">
                {childAmendments.map((a: any) => (
                  <li key={a.id}>
                    <Link
                      href={`/dashboard/ehr/notes/${a.id}`}
                      className="underline hover:text-blue-900"
                    >
                      {a.title}
                    </Link>
                    <span className="text-blue-600 text-xs ml-1">({a.status})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <NoteEditor patients={patients ?? []} mode="edit" initial={initial} />
      </div>
    </div>
  )
}

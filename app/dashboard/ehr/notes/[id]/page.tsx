// app/dashboard/ehr/notes/[id]/page.tsx
// Detail view for a single progress note. Two modes:
//   - draft: show editable form + Sign button
//   - signed/amended: show read-only view with signed metadata

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft, GitBranch } from 'lucide-react'
import { pool } from '@/lib/aws/db'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { NoteEditor, type NoteFormValue } from '@/components/ehr/NoteEditor'
import { SignButton } from './SignButton'
import { AmendButton } from './AmendButton'
import { CosignButton } from './CosignButton'

export const dynamic = 'force-dynamic'

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const practiceId = await getEffectivePracticeId(null)
  if (!practiceId) redirect('/dashboard')

  const { rows: noteRows } = await pool.query(
    `SELECT * FROM ehr_progress_notes WHERE id = $1 AND practice_id = $2 LIMIT 1`,
    [id, practiceId],
  )
  const note = noteRows[0]
  if (!note) return notFound()

  const { rows: patients } = await pool.query<{ id: string; first_name: string; last_name: string }>(
    `SELECT id, first_name, last_name FROM patients
      WHERE practice_id = $1 AND deleted_at IS NULL
      ORDER BY last_name NULLS LAST, first_name NULLS LAST`,
    [practiceId],
  )

  const initial: NoteFormValue = {
    id: note.id,
    patient_id: note.patient_id,
    title: note.title,
    note_format: note.format ?? note.note_format ?? 'soap',
    subjective: note.subjective,
    objective: note.objective,
    assessment: note.assessment,
    plan: note.plan ?? note.plan_text ?? null,
    body: note.body ?? note.content ?? null,
    cpt_codes: Array.isArray(note.cpt_codes) ? note.cpt_codes : (note.cpt_code ? [note.cpt_code] : []),
    icd10_codes: Array.isArray(note.icd10_codes) ? note.icd10_codes : (Array.isArray(note.icd_codes) ? note.icd_codes : []),
    status: note.status,
  }

  const isDraft = note.status === 'draft'
  const isSigned = note.status === 'signed' || note.status === 'amended'

  // Lineage — if this note amends another, or has amendments pointing at it.
  let parent: { id: string; title: string; signed_at: string | null } | null = null
  if (note.amendment_of) {
    const { rows: parentRows } = await pool.query(
      `SELECT id, title, signed_at FROM ehr_progress_notes
        WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [note.amendment_of, practiceId],
    )
    if (parentRows[0]) parent = parentRows[0] as any
  }
  const { rows: childAmendments } = await pool.query<{
    id: string; title: string; status: string; created_at: string; signed_at: string | null
  }>(
    `SELECT id, title, status, created_at, signed_at FROM ehr_progress_notes
      WHERE amendment_of = $1 AND practice_id = $2
      ORDER BY created_at ASC`,
    [note.id, practiceId],
  )

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
            {note.format ?? note.note_format} · {note.status}
            {note.signed_at && (
              <> · signed {new Date(note.signed_at).toLocaleString()}</>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {isDraft && <SignButton noteId={note.id} />}
          {isSigned && <AmendButton noteId={note.id} />}
          {isSigned && note.requires_cosign && !note.cosigned_at && (
            <CosignButton noteId={note.id} />
          )}
          {note.cosigned_at && (
            <span className="inline-flex items-center gap-1 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-full font-medium">
              Co-signed {new Date(note.cosigned_at).toLocaleDateString()}
            </span>
          )}
        </div>
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
        <NoteEditor patients={patients} mode="edit" initial={initial} />
      </div>
    </div>
  )
}

// app/dashboard/ehr/notes/new/page.tsx
//
// Wave 21 (AWS port). Server component — Cognito + pool. Fetches the
// patient list to populate the editor dropdown and (optionally) resolves
// patient_id from a pre-filled appointment_id.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { pool } from '@/lib/aws/db'
import { getEffectivePracticeId } from '@/lib/active-practice'
import { NoteEditor, type NoteFormValue } from '@/components/ehr/NoteEditor'
import { NOTE_TEMPLATES } from '@/lib/ehr/note-templates'
import { NewNoteWrapper } from './NewNoteWrapper'

export const dynamic = 'force-dynamic'

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ patient_id?: string; appointment_id?: string; template?: string }>
}) {
  const { patient_id: prefilledPatientId, appointment_id: prefilledAppointmentId, template: templateId } = await searchParams

  const practiceId = await getEffectivePracticeId(null)
  if (!practiceId) redirect('/dashboard')

  // If appointment_id was passed but patient_id wasn't, resolve the
  // patient from the appointment so the editor's dropdown lands on it.
  let resolvedPatientId = prefilledPatientId
  if (!resolvedPatientId && prefilledAppointmentId) {
    const { rows } = await pool.query<{ patient_id: string }>(
      `SELECT patient_id FROM appointments
        WHERE id = $1 AND practice_id = $2 LIMIT 1`,
      [prefilledAppointmentId, practiceId],
    )
    if (rows[0]?.patient_id) resolvedPatientId = rows[0].patient_id
  }

  const { rows: patients } = await pool.query<{ id: string; first_name: string; last_name: string }>(
    `SELECT id, first_name, last_name FROM patients
      WHERE practice_id = $1 AND deleted_at IS NULL
      ORDER BY last_name NULLS LAST, first_name NULLS LAST`,
    [practiceId],
  )

  const tpl = templateId ? NOTE_TEMPLATES.find((t) => t.id === templateId) : undefined
  const initial: NoteFormValue | undefined = (resolvedPatientId || tpl || prefilledAppointmentId)
    ? {
        patient_id: resolvedPatientId ?? '',
        title: tpl?.title_prefix ?? '',
        note_format: tpl?.note_format ?? 'soap',
        subjective: tpl?.subjective ?? '',
        objective: tpl?.objective ?? '',
        assessment: tpl?.assessment ?? '',
        plan: tpl?.plan ?? '',
        body: tpl?.body ?? '',
        cpt_codes: tpl?.suggested_cpt ?? [],
        icd10_codes: [],
        appointment_id: prefilledAppointmentId ?? null,
      }
    : undefined

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Link
        href="/dashboard/ehr/notes"
        className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to notes
      </Link>

      <h1 className="text-2xl font-semibold text-gray-900 mb-1">New progress note</h1>
      <p className="text-sm text-gray-500 mb-6">
        Pick a template to pre-fill structure, or start blank. Drafts save when you click &quot;Create note&quot;.
      </p>

      {!tpl && (
        <NewNoteWrapper
          patientId={resolvedPatientId}
          appointmentId={prefilledAppointmentId}
        />
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <NoteEditor patients={patients} mode="create" initial={initial} />
      </div>
    </div>
  )
}

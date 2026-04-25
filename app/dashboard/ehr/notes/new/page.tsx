// app/dashboard/ehr/notes/new/page.tsx
// Create a new progress note. Server component fetches the patient list
// (so the form can populate the dropdown), then renders the client editor.

import Link from 'next/link'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { ChevronLeft } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase'
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

  // If appointment_id was passed but patient_id wasn't, resolve the
  // patient from the appointment so the editor's dropdown lands on it.
  let resolvedPatientId = prefilledPatientId
  if (!resolvedPatientId && prefilledAppointmentId) {
    const { data: appt } = await supabaseAdmin
      .from('appointments')
      .select('patient_id')
      .eq('id', prefilledAppointmentId)
      .eq('practice_id', practiceId!)
      .maybeSingle()
    if (appt?.patient_id) resolvedPatientId = appt.patient_id
  }

  const { data: patients = [] } = await supabaseAdmin
    .from('patients')
    .select('id, first_name, last_name')
    .eq('practice_id', practiceId!)
    .order('last_name', { ascending: true })

  // If ?patient_id=X or ?template=Y is passed, seed the editor with a
  // partially-filled NoteFormValue. Templates come from NOTE_TEMPLATES.
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
        <NoteEditor patients={patients ?? []} mode="create" initial={initial} />
      </div>
    </div>
  )
}

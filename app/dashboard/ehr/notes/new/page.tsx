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

export const dynamic = 'force-dynamic'

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ patient_id?: string }>
}) {
  const { patient_id: prefilledPatientId } = await searchParams
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

  const { data: patients = [] } = await supabaseAdmin
    .from('patients')
    .select('id, first_name, last_name')
    .eq('practice_id', practiceId!)
    .order('last_name', { ascending: true })

  // If ?patient_id=X is passed (from the patient detail "New note" button),
  // prefill the form so the dropdown starts on that patient.
  const initial: NoteFormValue | undefined = prefilledPatientId
    ? {
        patient_id: prefilledPatientId,
        title: '',
        note_format: 'soap',
        subjective: '',
        objective: '',
        assessment: '',
        plan: '',
        body: '',
        cpt_codes: [],
        icd10_codes: [],
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
        Drafts auto-save when you click &quot;Create note&quot;. You can sign it from the detail view.
      </p>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <NoteEditor patients={patients ?? []} mode="create" initial={initial} />
      </div>
    </div>
  )
}

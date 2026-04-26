// app/dashboard/ehr/notes/page.tsx
// List view for progress notes. Server component — fetches via supabaseAdmin
// with a practice_id filter resolved from the current user.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileText, Plus } from 'lucide-react'
import { pool } from '@/lib/aws/db'
import { getEffectivePracticeId } from '@/lib/active-practice'

export const dynamic = 'force-dynamic'

type NoteRow = {
  id: string
  title: string
  format: string
  status: string
  created_at: string
  updated_at: string
  patient_id: string
}

export default async function EhrNotesListPage() {
  // Wave 21: Cognito + pool. The /dashboard/ehr layout already gates on
  // ehr_enabled + Cognito session, so by the time we get here we have a
  // valid session — but practice_id may still be null for users with no
  // users row, in which case we redirect to /dashboard.
  const practiceId = await getEffectivePracticeId(null)
  if (!practiceId) redirect('/dashboard')

  const { rows: notes } = await pool.query<NoteRow>(
    `SELECT id, title, format, status, created_at, updated_at, patient_id
       FROM ehr_progress_notes
      WHERE practice_id = $1
      ORDER BY created_at DESC
      LIMIT 200`,
    [practiceId],
  )

  const patientIds = Array.from(new Set(notes.map((n) => n.patient_id)))
  const patientMap = new Map<string, { id: string; first_name: string; last_name: string }>()
  if (patientIds.length > 0) {
    const { rows: patients } = await pool.query<{ id: string; first_name: string; last_name: string }>(
      `SELECT id, first_name, last_name FROM patients
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [patientIds],
    )
    for (const p of patients) patientMap.set(p.id, p)
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Progress notes</h1>
          <p className="text-sm text-gray-500 mt-1">
            Clinical documentation for your patients. Draft, edit, sign — all tied to the patient record.
          </p>
        </div>
        <Link
          href="/dashboard/ehr/notes/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg"
        >
          <Plus className="w-4 h-4" />
          New note
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        {!notes || notes.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-500">No progress notes yet.</p>
            <Link
              href="/dashboard/ehr/notes/new"
              className="mt-4 inline-block text-sm text-teal-700 hover:text-teal-900 font-medium"
            >
              Create the first one
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {notes.map((n: NoteRow) => {
              const patient = patientMap.get(n.patient_id) as any
              return (
                <li key={n.id}>
                  <Link
                    href={`/dashboard/ehr/notes/${n.id}`}
                    className="block px-5 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 truncate">{n.title}</span>
                          <StatusBadge status={n.status} />
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown patient'}
                          {' · '}
                          {n.format.toUpperCase()}
                          {' · '}
                          Last updated {formatDate(n.updated_at)}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft:    'bg-amber-50 text-amber-800 border-amber-200',
    signed:   'bg-emerald-50 text-emerald-700 border-emerald-200',
    amended:  'bg-blue-50 text-blue-700 border-blue-200',
    deleted:  'bg-gray-50 text-gray-500 border-gray-200',
  }
  const cls = styles[status] ?? styles.draft
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {status}
    </span>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

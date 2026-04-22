// components/ehr/PatientProgressNotes.tsx
// Embed on the patient detail page: lists progress notes for this patient,
// with a quick-create button. Renders nothing if EHR isn't enabled for
// the practice (the API returns 403 and we just stay quiet).

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, Plus } from 'lucide-react'
import { AIDraftButton } from './AIDraftButton'

type Note = {
  id: string
  title: string
  note_format: string
  status: string
  created_at: string
  updated_at: string
}

export function PatientProgressNotes({ patientId }: { patientId: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/ehr/notes?patient_id=${encodeURIComponent(patientId)}`)
        if (res.status === 403) {
          if (!cancelled) setEnabled(false)
          return
        }
        const json = await res.json()
        if (!cancelled) setNotes(json.notes || [])
      } catch {
        if (!cancelled) setNotes([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [patientId])

  if (!enabled) return null
  if (loading) return null

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-500" />
          Progress Notes ({notes?.length ?? 0})
        </h2>
        <div className="flex items-center gap-2">
          <AIDraftButton patientId={patientId} />
          <Link
            href={`/dashboard/ehr/notes/new?patient_id=${encodeURIComponent(patientId)}`}
            className="inline-flex items-center gap-1.5 text-sm bg-teal-600 text-white px-3 py-1.5 rounded-md hover:bg-teal-700 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            New note
          </Link>
        </div>
      </div>

      {notes && notes.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {notes.map((n) => (
            <li key={n.id}>
              <Link
                href={`/dashboard/ehr/notes/${n.id}`}
                className="block py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded-md transition"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 text-sm">{n.title}</span>
                  <StatusBadge status={n.status} />
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {n.note_format.toUpperCase()} · {formatDate(n.updated_at)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">
          No progress notes yet. Create one above to start documenting this patient&apos;s care.
        </p>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft:   'bg-amber-50 text-amber-800 border-amber-200',
    signed:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    amended: 'bg-blue-50 text-blue-700 border-blue-200',
    deleted: 'bg-gray-50 text-gray-500 border-gray-200',
  }
  const cls = styles[status] ?? styles.draft
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
      {status}
    </span>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

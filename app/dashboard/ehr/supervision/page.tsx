// app/dashboard/ehr/supervision/page.tsx
// Supervisor queue: signed notes from supervisees that need co-sign.
// Solo practices see an empty state.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PenLine as Signature, Clock } from 'lucide-react'

type PendingNote = {
  id: string
  title: string
  created_at: string
  signed_at: string | null
  patient_id: string
  signed_by_name?: string | null
  patient_first?: string | null
  patient_last?: string | null
}

export default function SupervisionPage() {
  const [notes, setNotes] = useState<PendingNote[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        // Wave 38 TS9 — dedicated supervisor queue endpoint scopes to
        // notes whose authoring users have me as their supervisor.
        const res = await fetch('/api/ehr/cosign-queue')
        if (!res.ok) { setNotes([]); return }
        const json = await res.json()
        setNotes(json.notes || [])
      } finally { setLoading(false) }
    })()
  }, [])

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <Signature className="w-6 h-6 text-teal-600" />
          Supervision Queue
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Signed notes from supervisees awaiting your co-sign. Click a note to review it and co-sign.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
        ) : !notes || notes.length === 0 ? (
          <div className="p-12 text-center">
            <Signature className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-500">Nothing awaiting co-sign.</p>
            <p className="text-xs text-gray-400 mt-2">
              Solo practices: set up an associate therapist and a supervision relationship to see this queue in action.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {notes.map((n) => (
              <li key={n.id}>
                <Link href={`/dashboard/ehr/notes/${n.id}`} className="block p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{n.title}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />
                        Signed {n.signed_at ? new Date(n.signed_at).toLocaleString() : '—'}
                      </div>
                    </div>
                    <span className="text-xs bg-amber-50 text-amber-800 border border-amber-200 px-2 py-1 rounded-full font-medium">
                      Awaiting co-sign
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

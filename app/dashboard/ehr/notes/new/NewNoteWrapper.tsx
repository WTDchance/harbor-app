// app/dashboard/ehr/notes/new/NewNoteWrapper.tsx
// Template picker strip shown above the blank note editor. Picking a
// template reloads the page with ?template=X so the server component
// pre-fills initial state from lib/ehr/note-templates.ts.

'use client'

import Link from 'next/link'
import { NOTE_TEMPLATES } from '@/lib/ehr/note-templates'
import { FileText } from 'lucide-react'

export function NewNoteWrapper({
  patientId, appointmentId,
}: {
  patientId?: string
  appointmentId?: string
}) {
  function href(tplId: string) {
    const p = new URLSearchParams()
    if (patientId) p.set('patient_id', patientId)
    if (appointmentId) p.set('appointment_id', appointmentId)
    p.set('template', tplId)
    return `/dashboard/ehr/notes/new?${p.toString()}`
  }

  return (
    <div className="mb-6 bg-gray-50 border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
        <FileText className="w-4 h-4 text-gray-500" />
        Start from a template
      </div>
      <div className="flex flex-wrap gap-2">
        {NOTE_TEMPLATES.map((t) => (
          <Link
            key={t.id}
            href={href(t.id)}
            className="inline-flex items-center px-3 py-1.5 bg-white border border-gray-200 rounded-md hover:border-teal-500 hover:bg-teal-50 text-xs font-medium text-gray-700 transition"
            title={t.description}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

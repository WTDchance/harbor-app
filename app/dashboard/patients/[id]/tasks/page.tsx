// app/dashboard/patients/[id]/tasks/page.tsx
//
// W46 T3 — per-patient Tasks tab.

'use client'

import { useParams } from 'next/navigation'
import ClinicalTasksList from '@/components/tasks/ClinicalTasksList'

export default function PatientTasksPage() {
  const params = useParams<{ id: string }>()
  const patientId = params?.id as string
  if (!patientId) return null

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <p className="text-sm text-gray-600 mt-1">
          Reminders specific to this patient. "Ask about her divorce in
          two weeks", "Send Aetna pre-auth packet by Friday" — anything
          you want to remember next session.
        </p>
      </div>
      <ClinicalTasksList patientId={patientId} />
    </div>
  )
}

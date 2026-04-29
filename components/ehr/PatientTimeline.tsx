// components/ehr/PatientTimeline.tsx
//
// W50 D4 — combined sparkline + ranked event cards.

'use client'

import PatientTimelineSparkline from './PatientTimelineSparkline'
import PatientTimelineEvents from './PatientTimelineEvents'

export default function PatientTimeline({ patientId }: { patientId: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Activity timeline</h3>
        <PatientTimelineSparkline patientId={patientId} />
      </div>
      <PatientTimelineEvents patientId={patientId} />
    </div>
  )
}

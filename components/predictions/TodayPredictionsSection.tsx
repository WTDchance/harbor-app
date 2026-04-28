// components/predictions/TodayPredictionsSection.tsx
//
// W45 T6 — Today screen "Predictions" section. Lists top flagged
// patients across no_show / dropout_risk with one-tap actions.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PredictionBadge } from './PredictionBadge'

type Flag = {
  prediction_id: string
  patient_id: string
  patient_name: string | null
  kind: string
  score: number
  factors_summary: string
  appointment_id: string | null
  scheduled_for: string | null
}

export default function TodayPredictionsSection() {
  const [flags, setFlags] = useState<Flag[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/ehr/predictions/top?limit=5')
        if (!res.ok) return
        const j = await res.json()
        setFlags(j.flags || [])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return null
  if (flags.length === 0) return null

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2 px-1">
        Predictions
      </h2>
      <div className="space-y-2">
        {flags.map((f) => (
          <div key={f.prediction_id} className="bg-white border border-gray-200 rounded-xl p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/dashboard/patients/${f.patient_id}`}
                  className="font-medium text-sm text-[#1f375d] hover:underline truncate block"
                >
                  {f.patient_name || 'Unknown patient'}
                </Link>
                <div className="text-xs text-gray-500 mt-0.5">
                  {f.kind === 'no_show'
                    ? f.scheduled_for
                      ? `Next appt ${new Date(f.scheduled_for).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                      : 'No-show risk'
                    : f.kind === 'dropout_risk'
                      ? 'Trending toward dropout'
                      : f.kind}
                </div>
                {f.factors_summary && (
                  <div className="text-xs text-gray-600 mt-1 italic">
                    {f.factors_summary}
                  </div>
                )}
              </div>
              <PredictionBadge
                compact
                kind={f.kind}
                score={f.score}
                label={f.kind === 'no_show' ? 'no-show' : f.kind === 'dropout_risk' ? 'dropout' : f.kind}
              />
            </div>
            {/* Quick actions */}
            <div className="mt-2 flex items-center gap-2 text-xs">
              <Link
                href={`/dashboard/patients/${f.patient_id}/messages/new`}
                className="text-[#1f375d] hover:underline"
              >
                Send check-in
              </Link>
              {f.appointment_id && (
                <Link
                  href={`/dashboard/appointments/${f.appointment_id}`}
                  className="text-[#1f375d] hover:underline"
                >
                  Open appointment
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

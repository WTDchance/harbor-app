// components/today/widgets/EngagementTrends.tsx
// W47 T0 — caseload-level engagement trend. Pulls aggregate from
// ehr_patient_predictions kind=engagement_score. Hides itself if
// no data yet.

'use client'
import { useEffect, useState } from 'react'

type Bucket = { range: string; count: number }

export default function EngagementTrendsWidget() {
  const [buckets, setBuckets] = useState<Bucket[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        // Reuse the prediction-accuracy endpoint's data shape if it
        // exists; otherwise fall back silently.
        const res = await fetch('/api/ehr/predictions/engagement-distribution').catch(() => null)
        if (!res || !res.ok) {
          setBuckets([])
          return
        }
        const j = await res.json()
        setBuckets(j.buckets || [])
      } finally { setLoading(false) }
    })()
  }, [])

  if (loading || !buckets || buckets.length === 0) return null

  const max = Math.max(1, ...buckets.map((b) => b.count))
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2 px-1">
        Engagement trends
      </h2>
      <div className="bg-white border border-gray-200 rounded-xl p-3">
        <div className="flex items-end gap-1 h-16">
          {buckets.map((b) => (
            <div key={b.range} className="flex-1 flex flex-col items-center justify-end">
              <div className="w-full bg-[#52bfc0] rounded-sm"
                   style={{ height: `${(b.count / max) * 100}%` }}
                   title={`${b.range}: ${b.count}`} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-gray-500 mt-1">
          {buckets.map((b) => <span key={b.range}>{b.range}</span>)}
        </div>
      </div>
    </div>
  )
}

// W52 D3 — practice outcome metrics dashboard.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface ByAssessment {
  assessment_slug: string; n: number; avg_reduction: number;
  responders: number; sustained_12w: number;
}

export default function PracticeOutcomesPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/ehr/practice/outcomes-summary')
      .then(r => r.ok ? r.json() : null).then(j => { setData(j); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-5xl mx-auto p-6">
      <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">← Back</Link>
      <h1 className="text-2xl font-semibold text-gray-900 mt-2">Outcomes</h1>
      <p className="text-sm text-gray-500 mt-1">Measurement-based care signal across your practice's patients.</p>

      {loading ? <div className="mt-6 text-sm text-gray-400">Loading…</div> : !data ? <div className="mt-6 text-sm text-red-600">Unable to load.</div> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
            <Stat label="Crisis flags · 90d" value={data.crisis_flags_90d} tone={data.crisis_flags_90d > 0 ? 'red' : 'gray'} />
            <Stat label="Assessment completion · 90d" value={`${data.engagement.ratio}%`} sub={`${data.engagement.completed}/${data.engagement.total}`} />
            <Stat label="Patients with paired baseline + current" value={(data.by_assessment ?? []).reduce((a: number, x: ByAssessment) => a + x.n, 0)} />
          </div>

          <h2 className="mt-8 mb-2 text-sm font-semibold text-gray-900">Reduction by instrument (baseline → current)</h2>
          {(data.by_assessment ?? []).length === 0 ? (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-sm text-gray-500">
              Need at least 2 administrations of PHQ-9 or GAD-7 per patient to compute reduction. Keep measuring.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl divide-y">
              {(data.by_assessment as ByAssessment[]).map(b => {
                const respRate = b.n > 0 ? Math.round((b.responders / b.n) * 100) : 0
                const sustainedRate = b.n > 0 ? Math.round((b.sustained_12w / b.n) * 100) : 0
                return (
                  <div key={b.assessment_slug} className="px-4 py-3">
                    <div className="flex items-baseline justify-between">
                      <div className="font-medium text-gray-900">{b.assessment_slug.toUpperCase()}</div>
                      <div className="text-xs text-gray-500">{b.n} paired patient{b.n === 1 ? '' : 's'}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mt-2 text-sm">
                      <div><span className="text-gray-500">Avg reduction:</span> <strong>{Number(b.avg_reduction).toFixed(1)} pts</strong></div>
                      <div><span className="text-gray-500">Treatment response:</span> <strong>{respRate}%</strong> <span className="text-xs text-gray-400">({b.responders} ≥50%)</span></div>
                      <div><span className="text-gray-500">Sustained @ 12w:</span> <strong>{sustainedRate}%</strong></div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: 'red' | 'gray' }) {
  const cls = tone === 'red' && Number(value) > 0 ? 'text-red-700' : 'text-gray-900'
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold ${cls}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  )
}

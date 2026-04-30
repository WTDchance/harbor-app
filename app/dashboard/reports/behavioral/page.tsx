// W52 D3 — practice behavioral metrics dashboard.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function BehavioralMetricsPage() {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch('/api/ehr/practice/behavioral-metrics')
      .then(r => r.ok ? r.json() : null).then(j => { setD(j); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-5xl mx-auto p-6">
      <Link href="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">← Back</Link>
      <h1 className="text-2xl font-semibold text-gray-900 mt-2">Behavioral metrics</h1>
      <p className="text-sm text-gray-500 mt-1">Receptionist conversion, predictive-model validation, and engagement.</p>

      {loading ? <div className="mt-6 text-sm text-gray-400">Loading…</div> : !d ? <div className="mt-6 text-sm text-red-600">Unable to load.</div> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-6">
            <Stat label="Calls (90d)" value={d.calls?.total_calls ?? 0} />
            <Stat label="Captured patient" value={d.calls?.captured_patient ?? 0} />
            <Stat label="Booked from calls" value={d.calls?.booked_from_calls ?? 0} />
            <Stat label="Avg call→book days" value={d.avg_call_to_book_days ? Number(d.avg_call_to_book_days).toFixed(1) : '—'} />
          </div>

          <h2 className="mt-8 mb-2 text-sm font-semibold text-gray-900">No-show rate by predicted-risk bucket (last 180 days)</h2>
          <div className="bg-white border border-gray-200 rounded-xl divide-y">
            {(d.no_show_by_predicted_risk ?? []).length === 0 ? (
              <div className="px-4 py-6 text-sm text-gray-500 text-center">Not enough completed appointments yet.</div>
            ) : (d.no_show_by_predicted_risk as any[]).map((b: any) => {
              const rate = b.appts > 0 ? Math.round((b.no_shows / b.appts) * 100) : 0
              return (
                <div key={b.bucket} className="px-4 py-3 flex items-center justify-between">
                  <div className="font-medium uppercase tracking-wide text-xs text-gray-700">{b.bucket} risk</div>
                  <div className="text-sm">
                    <strong>{rate}%</strong>
                    <span className="text-gray-500 ml-2">({b.no_shows}/{b.appts} appts)</span>
                  </div>
                </div>
              )
            })}
          </div>

          <h2 className="mt-8 mb-2 text-sm font-semibold text-gray-900">Engagement (last 90 days)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label="Active patients" value={d.attendance?.active_patients_90d ?? 0} />
            <Stat label="Attendance rate" value={`${d.attendance?.rate ?? 0}%`} sub={`${d.attendance?.kept}/${d.attendance?.total}`} />
            <Stat label="Sessions per active patient" value={d.attendance?.sessions_per_active_patient ?? 0} />
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  )
}

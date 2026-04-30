// W52 D5 — receptionist conversion funnel.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Funnel {
  step1_calls: number; step2_intake: number; step3_booked: number;
  step4_attended: number; step5_phq9: number; step6_returning: number;
  window_days: number;
}

export default function ReceptionistFunnelPage() {
  const [f, setF] = useState<Funnel | null>(null)
  const [days, setDays] = useState(90)
  useEffect(() => {
    fetch(`/api/ehr/receptionist/funnel?days=${days}`)
      .then(r => r.ok ? r.json() : null).then(j => setF(j))
  }, [days])

  const STEPS: { key: keyof Funnel; label: string }[] = [
    { key: 'step1_calls',     label: 'Intake calls received' },
    { key: 'step2_intake',    label: 'Captured complete intake' },
    { key: 'step3_booked',    label: 'Booked an appointment' },
    { key: 'step4_attended',  label: 'Attended that appointment' },
    { key: 'step5_phq9',      label: 'Completed PHQ-9 within 7 days' },
    { key: 'step6_returning', label: 'Returned for second session' },
  ]

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href="/dashboard/receptionist/calls" className="text-sm text-gray-500 hover:text-gray-700">← Calls</Link>
      <div className="flex items-center justify-between mt-2">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Conversion funnel</h1>
          <p className="text-sm text-gray-500">From inbound call to repeat session.</p>
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="border border-gray-300 rounded px-2 py-1 text-sm">
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={180}>Last 180 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {!f ? <div className="mt-6 text-sm text-gray-400">Loading…</div> : (
        <div className="mt-6 space-y-2">
          {STEPS.map((s, i) => {
            const total = f.step1_calls
            const v = (f as any)[s.key] as number
            const pctOfTotal = total > 0 ? Math.round((v / total) * 100) : 0
            const prev = i === 0 ? v : (f as any)[STEPS[i - 1].key] as number
            const pctOfPrev = prev > 0 ? Math.round((v / prev) * 100) : 0
            return (
              <div key={s.key} className="bg-white border border-gray-200 rounded-md px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <div className="text-sm font-medium text-gray-900">{s.label}</div>
                  <div className="text-sm tabular-nums">{v} <span className="text-gray-400 text-xs">({pctOfTotal}% of calls)</span></div>
                </div>
                <div className="mt-1.5 w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-blue-500 h-full rounded-full" style={{ width: `${pctOfTotal}%` }} />
                </div>
                {i > 0 && <div className="text-[10px] text-gray-500 mt-1">{pctOfPrev}% of prior step</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

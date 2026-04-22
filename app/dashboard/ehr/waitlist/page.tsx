// app/dashboard/ehr/waitlist/page.tsx — prioritized waitlist view.
'use client'

import { useEffect, useState } from 'react'
import { Users, Phone, Mail, Zap, Clock } from 'lucide-react'

type Entry = {
  id: string
  patient_name: string
  patient_phone: string | null
  patient_email: string | null
  insurance_type: string | null
  session_type: string | null
  reason: string | null
  priority: number | null
  status: string
  notes: string | null
  flexible_day_time: boolean | null
  opt_in_last_minute: boolean | null
  opt_in_flash_fill: boolean | null
  composite_score: number | null
  created_at: string
}

export default function WaitlistPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null)

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/ehr/waitlist')
      if (r.ok) setEntries((await r.json()).entries || [])
    })()
  }, [])

  const active = (entries ?? []).filter((e) => e.status === 'active' || e.status === 'waiting')
  const other = (entries ?? []).filter((e) => !(e.status === 'active' || e.status === 'waiting'))

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <Users className="w-6 h-6 text-teal-600" />
          Waitlist
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Patients waiting for an opening, ranked by their composite score (priority × flexibility × opt-in signals).
        </p>
      </div>

      {entries === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : active.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-500">
          No one on the waitlist. Good problem to have.
        </div>
      ) : (
        <div className="space-y-2">
          {active.map((e, i) => (
            <div key={e.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-3">
              <div className="flex flex-col items-center min-w-[40px]">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">#</div>
                <div className="text-2xl font-bold text-gray-900">{i + 1}</div>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="text-base font-semibold text-gray-900">{e.patient_name}</div>
                  {e.composite_score != null && (
                    <span className="text-xs bg-teal-50 text-teal-800 border border-teal-200 px-2 py-0.5 rounded-full">
                      score {e.composite_score}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-600 flex-wrap mb-1">
                  {e.patient_phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{e.patient_phone}</span>}
                  {e.patient_email && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{e.patient_email}</span>}
                  {e.session_type && <span>· {e.session_type}</span>}
                  {e.insurance_type && <span>· {e.insurance_type}</span>}
                </div>
                {e.reason && <div className="text-xs text-gray-700 mb-1">{e.reason}</div>}
                <div className="flex items-center gap-2 flex-wrap">
                  {e.flexible_day_time && (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded-full">
                      <Clock className="w-3 h-3" /> Flexible
                    </span>
                  )}
                  {e.opt_in_flash_fill && (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-full">
                      <Zap className="w-3 h-3" /> Flash fill
                    </span>
                  )}
                  {e.opt_in_last_minute && (
                    <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-full">
                      Last-minute OK
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {other.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs uppercase tracking-wider text-gray-500 mb-2">History</h2>
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {other.map((e) => (
              <div key={e.id} className="p-3 flex items-center justify-between text-sm">
                <div>
                  <span className="text-gray-700">{e.patient_name}</span>
                  <span className="text-xs text-gray-500 ml-2">{e.status}</span>
                </div>
                <span className="text-xs text-gray-400">{new Date(e.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

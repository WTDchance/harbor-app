// components/ehr/CallSignalsFeed.tsx
//
// W50 D2 — chronological feed of receptionist call signals for a patient.

'use client'

import { useEffect, useState } from 'react'

interface Signal {
  id: string
  call_id: string
  signal_type: string
  signal_value: string | null
  confidence: number | string
  raw_excerpt: string | null
  extracted_by: 'regex' | 'bedrock'
  extracted_at: string
  call_at: string | null
  duration_seconds: number | null
  from_number: string | null
  call_summary: string | null
}

const SIGNAL_META: Record<string, { label: string; cls: string }> = {
  crisis_flag:        { label: 'Crisis flag',          cls: 'bg-red-50 border-red-300 text-red-800' },
  urgency_high:       { label: 'Urgency · high',       cls: 'bg-orange-50 border-orange-300 text-orange-800' },
  urgency_medium:     { label: 'Urgency · med',        cls: 'bg-amber-50 border-amber-300 text-amber-800' },
  urgency_low:        { label: 'Urgency · low',        cls: 'bg-stone-50 border-stone-300 text-stone-700' },
  hesitation:         { label: 'Hesitation',           cls: 'bg-yellow-50 border-yellow-300 text-yellow-800' },
  scheduling_intent:  { label: 'Wants to schedule',    cls: 'bg-emerald-50 border-emerald-300 text-emerald-800' },
  scheduling_friction:{ label: 'Scheduling friction',  cls: 'bg-rose-50 border-rose-300 text-rose-800' },
  intent:             { label: 'Intent',               cls: 'bg-blue-50 border-blue-300 text-blue-800' },
  name_candidate:     { label: 'Name captured',        cls: 'bg-indigo-50 border-indigo-300 text-indigo-700' },
  dob_candidate:      { label: 'DOB captured',         cls: 'bg-indigo-50 border-indigo-300 text-indigo-700' },
  phone_confirmation: { label: 'Phone confirmed',      cls: 'bg-indigo-50 border-indigo-300 text-indigo-700' },
  insurance_mention:  { label: 'Insurance mentioned',  cls: 'bg-cyan-50 border-cyan-300 text-cyan-800' },
  sentiment_positive: { label: 'Positive sentiment',   cls: 'bg-emerald-50 border-emerald-300 text-emerald-800' },
  sentiment_negative: { label: 'Negative sentiment',   cls: 'bg-rose-50 border-rose-300 text-rose-800' },
  dropout_signal:     { label: 'Dropout signal',       cls: 'bg-red-50 border-red-300 text-red-800' },
  payment_concern:    { label: 'Payment concern',      cls: 'bg-amber-50 border-amber-300 text-amber-800' },
}

export default function CallSignalsFeed({ patientId, limit = 30 }: { patientId: string; limit?: number }) {
  const [signals, setSignals] = useState<Signal[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/ehr/patients/${patientId}/call-signals?limit=${limit}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('failed')))
      .then(j => { if (!cancelled) setSignals(j.signals ?? []) })
      .catch(() => { if (!cancelled) setError('Could not load') })
    return () => { cancelled = true }
  }, [patientId, limit])

  if (error) return <div className="text-sm text-gray-500">{error}</div>
  if (signals === null) return <div className="text-sm text-gray-400">Loading…</div>
  if (signals.length === 0) return <div className="text-sm text-gray-400">No call signals yet.</div>

  // Group by call_id
  const groups = new Map<string, Signal[]>()
  for (const s of signals) {
    const arr = groups.get(s.call_id) ?? []
    arr.push(s); groups.set(s.call_id, arr)
  }

  return (
    <div className="space-y-3">
      {Array.from(groups.entries()).map(([callId, list]) => {
        const head = list[0]
        return (
          <div key={callId} className="border border-gray-200 rounded-md p-3 bg-white">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
              <div>
                {head.call_at ? new Date(head.call_at).toLocaleString() : '—'}
                {head.duration_seconds != null && ` · ${Math.round(head.duration_seconds / 60)}m`}
                {head.from_number && ` · ${head.from_number}`}
              </div>
              <a href={`/dashboard/receptionist/calls/${callId}`} className="text-blue-600 hover:underline">View call →</a>
            </div>
            {head.call_summary && (
              <p className="text-xs text-gray-700 mb-2 italic">{head.call_summary}</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {list.map(s => {
                const meta = SIGNAL_META[s.signal_type] ?? { label: s.signal_type, cls: 'bg-gray-50 border-gray-300 text-gray-700' }
                const conf = typeof s.confidence === 'string' ? Number(s.confidence) : s.confidence
                return (
                  <span key={s.id} title={s.raw_excerpt ?? ''}
                    className={`text-[11px] px-2 py-0.5 rounded border ${meta.cls}`}>
                    {meta.label}{s.signal_value && s.signal_type !== 'hesitation' ? ` · ${s.signal_value}` : ''}
                    <span className="opacity-60 ml-1">({Math.round((conf || 0) * 100)}%)</span>
                  </span>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

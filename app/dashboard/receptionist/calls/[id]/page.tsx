// app/dashboard/receptionist/calls/[id]/page.tsx
//
// W50 D5 — call detail. Audio + transcript with signals highlighted +
// captured-data panel + corrections + audit.

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface Signal {
  id: string
  signal_type: string
  signal_value: string | null
  confidence: number | string
  raw_excerpt: string | null
  extracted_by: 'regex' | 'bedrock'
  extracted_at: string
}

interface Capture { value: string; confidence: number | null; source: string }

interface Correction {
  id: string; field_name: string; original_value: string | null; corrected_value: string | null
  corrected_at: string; corrected_by_user_id: string; notes: string | null
}

interface CallRow {
  id: string; created_at: string; from_number: string | null; to_number: string | null
  duration_seconds: number | null; summary: string | null; transcript: string | unknown | null
  recording_url: string | null; patient_id: string | null
  inferred_crisis_risk: boolean | null
  inferred_no_show_intent: boolean | null
  inferred_reschedule_intent: boolean | null
  caller_sentiment_score: number | null
}

const FIELD_LABELS: Record<string, string> = {
  patient_name: 'Name',
  patient_dob: 'Date of birth',
  patient_phone: 'Phone',
  patient_email: 'Email',
  insurance_carrier: 'Insurance',
  insurance_member_id: 'Member ID',
  reason_for_call: 'Reason for call',
  urgency: 'Urgency',
  patient_match_id: 'Matched patient',
  outcome: 'Outcome',
}

export default function CallDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const [call, setCall] = useState<CallRow | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [captures, setCaptures] = useState<Record<string, Capture>>({})
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const r = await fetch(`/api/ehr/receptionist/calls/${id}`)
    const j = await r.json()
    if (!r.ok) { setError(j.error || 'Failed to load'); return }
    setCall(j.call); setSignals(j.signals ?? []); setCaptures(j.captures ?? {}); setCorrections(j.corrections ?? [])
  }
  useEffect(() => { void load() }, [id])

  async function saveCorrection() {
    if (!editing) return
    const orig = captures[editing]?.value ?? null
    const r = await fetch(`/api/ehr/receptionist/calls/${id}/corrections`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ field_name: editing, original_value: orig, corrected_value: editValue }),
    })
    if (r.ok) { setEditing(null); setEditValue(''); void load() }
  }

  // Build a signal-highlighted transcript by replacing raw_excerpts with
  // <mark> wrappers. Cheap O(transcript × signals) but fine for review.
  const highlighted = useMemo(() => {
    if (!call?.transcript) return null
    const raw = typeof call.transcript === 'string' ? call.transcript : JSON.stringify(call.transcript, null, 2)
    let html = raw.replace(/[<>&]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[ch] as string))
    const distinct = Array.from(new Set(signals.map(s => s.raw_excerpt).filter(Boolean) as string[]))
    distinct.sort((a, b) => b.length - a.length) // longest first
    for (const ex of distinct) {
      const escaped = ex.replace(/[<>&]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[ch] as string))
                       .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      try {
        html = html.replace(new RegExp(escaped, 'g'),
          `<mark class="bg-yellow-100 px-0.5 rounded">${ex.replace(/[<>&]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[ch] as string))}</mark>`)
      } catch { /* skip bad regex */ }
    }
    return html
  }, [call?.transcript, signals])

  if (error) return <div className="max-w-4xl mx-auto p-6 text-sm text-red-600">{error}</div>
  if (!call) return <div className="max-w-4xl mx-auto p-6 text-sm text-gray-400">Loading…</div>

  return (
    <div className="max-w-5xl mx-auto p-6">
      <Link href="/dashboard/receptionist/calls" className="text-sm text-gray-500 hover:text-gray-700">← All calls</Link>

      <div className="mt-2 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{call.from_number ?? 'Unknown caller'}</h1>
          <p className="text-sm text-gray-500">
            {new Date(call.created_at).toLocaleString()}
            {call.duration_seconds != null && ` · ${Math.round(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s`}
          </p>
        </div>
        {call.patient_id && (
          <Link href={`/dashboard/patients/${call.patient_id}`} className="text-sm text-blue-600 hover:underline">
            Open patient →
          </Link>
        )}
      </div>

      {call.recording_url && (
        <div className="mt-4">
          <audio controls src={call.recording_url} className="w-full" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4 mt-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Transcript</h2>
          {highlighted ? (
            <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed"
              dangerouslySetInnerHTML={{ __html: highlighted }} />
          ) : (
            <p className="text-sm text-gray-400">No transcript available.</p>
          )}
        </div>

        <aside className="space-y-4">
          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Captured data</h2>
            <ul className="space-y-2">
              {Object.entries(FIELD_LABELS).map(([k, label]) => {
                const cap = captures[k]
                const correction = corrections.find(c => c.field_name === k)
                const display = correction?.corrected_value ?? cap?.value ?? null
                return (
                  <li key={k}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500">{label}</span>
                      <button onClick={() => { setEditing(k); setEditValue(display ?? '') }} className="text-[10px] text-blue-600 hover:text-blue-800">Edit</button>
                    </div>
                    {editing === k ? (
                      <div className="mt-1 flex gap-1">
                        <input className="flex-1 border rounded px-2 py-0.5 text-sm" value={editValue} onChange={e => setEditValue(e.target.value)} />
                        <button onClick={saveCorrection} className="text-xs bg-blue-600 text-white rounded px-2">Save</button>
                        <button onClick={() => setEditing(null)} className="text-xs text-gray-500">×</button>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-900">
                        {display ?? <span className="text-gray-300">—</span>}
                        {cap?.confidence != null && (
                          <span className="text-[10px] text-gray-400 ml-1">{Math.round(cap.confidence * 100)}%</span>
                        )}
                        {correction && (
                          <span className="text-[10px] text-emerald-600 ml-1">corrected</span>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Signals ({signals.length})</h2>
            <div className="flex flex-wrap gap-1">
              {signals.map(s => (
                <span key={s.id} title={s.raw_excerpt ?? ''}
                  className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-700">
                  {s.signal_type}
                </span>
              ))}
              {signals.length === 0 && <span className="text-xs text-gray-400">No signals.</span>}
            </div>
          </section>

          {corrections.length > 0 && (
            <section className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-2">Corrections ({corrections.length})</h2>
              <ul className="space-y-2">
                {corrections.map(c => (
                  <li key={c.id} className="text-xs">
                    <div className="text-gray-700"><strong>{FIELD_LABELS[c.field_name] ?? c.field_name}</strong></div>
                    <div className="text-gray-500"><s>{c.original_value || '—'}</s> → {c.corrected_value || '—'}</div>
                    <div className="text-gray-400">{new Date(c.corrected_at).toLocaleString()}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

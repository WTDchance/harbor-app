// components/ehr/AssessmentsCard.tsx
// Assessments + outcomes card on the patient profile.
//   - Line chart per instrument with severity bands shaded in the background
//   - Symptom-level breakdown (latest administration's item responses)
//   - "Assign to patient" flow — therapist selects an instrument, patient
//     completes on portal, score auto-calculates, alerts trigger, and it
//     shows up here
//   - In-session manual score entry still available
//   - AI interpretation — Sonnet reads trend + context + writes a clinical
//     summary the therapist can paste into a note
//   - Risk-flag badges for alerts (suicidal ideation etc.)

'use client'

import { useEffect, useState } from 'react'
import { Activity, Plus, Sparkles, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { INSTRUMENTS, getInstrument } from '@/lib/ehr/instruments'

type Assessment = {
  id: string
  assessment_type: string
  score: number | null
  severity: string | null
  status: string
  assigned_at: string | null
  expires_at: string | null
  completed_at: string | null
  created_at: string
  responses_json?: Record<string, number> | null
  alerts_triggered?: Array<{ type: string; severity: string; message: string }> | null
  interpretation?: string | null
  interpretation_generated_at?: string | null
}

type Mode = 'idle' | 'assign' | 'record'

export function AssessmentsCard({ patientId }: { patientId: string }) {
  const [items, setItems] = useState<Assessment[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('idle')
  const [formType, setFormType] = useState(INSTRUMENTS[0].id)
  const [formScore, setFormScore] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [working, setWorking] = useState(false)
  const [interpreting, setInterpreting] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch(`/api/ehr/assessments?patient_id=${encodeURIComponent(patientId)}`)
      if (res.status === 403) { setEnabled(false); return }
      const json = await res.json()
      setItems(json.assessments || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [patientId])

  async function submitManualScore(e: React.FormEvent) {
    e.preventDefault()
    const score = parseInt(formScore, 10)
    if (isNaN(score) || score < 0) return
    setWorking(true)
    try {
      const res = await fetch('/api/ehr/assessments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, assessment_type: formType, score, notes: formNotes || null }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setMode('idle'); setFormScore(''); setFormNotes('')
      await load()
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setWorking(false) }
  }

  async function assignToPatient() {
    setWorking(true)
    try {
      const res = await fetch('/api/ehr/assessments/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, assessment_type: formType }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setMode('idle')
      await load()
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setWorking(false) }
  }

  async function interpret(type: string) {
    setInterpreting(type)
    try {
      const res = await fetch('/api/ehr/assessments/interpret', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, assessment_type: type }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      await load()
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setInterpreting(null) }
  }

  if (!enabled || loading) return null

  const completed = (items ?? []).filter((a) => a.status === 'completed')
  const pending = (items ?? []).filter((a) => a.status === 'pending')

  // Group completed by instrument type
  const byType = new Map<string, Assessment[]>()
  for (const a of completed) {
    const k = a.assessment_type.toUpperCase()
    if (!byType.has(k)) byType.set(k, [])
    byType.get(k)!.push(a)
  }

  const typesWithData = Array.from(byType.keys())

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-500" />
          Assessments &amp; Outcomes
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode(mode === 'record' ? 'idle' : 'record')}
            className="text-xs bg-white border border-gray-300 text-gray-700 px-2.5 py-1.5 rounded-md hover:bg-gray-50"
          >
            Record in-session
          </button>
          <button
            onClick={() => setMode(mode === 'assign' ? 'idle' : 'assign')}
            className="inline-flex items-center gap-1.5 text-sm bg-teal-600 text-white px-3 py-1.5 rounded-md hover:bg-teal-700"
          >
            <Plus className="w-3.5 h-3.5" />
            Assign to patient
          </button>
        </div>
      </div>

      {/* Pending assignments */}
      {pending.length > 0 && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="text-sm font-medium text-blue-900 mb-1">
            {pending.length} assessment{pending.length === 1 ? '' : 's'} pending patient response:
          </div>
          <ul className="text-xs text-blue-800 space-y-0.5">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="font-mono">{p.assessment_type}</span>
                <span className="text-blue-600">
                  assigned {p.assigned_at ? new Date(p.assigned_at).toLocaleDateString() : ''} ·
                  expires {p.expires_at ? new Date(p.expires_at).toLocaleDateString() : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Assign mode */}
      {mode === 'assign' && (
        <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="text-sm font-medium text-gray-700 mb-2">Assign to the patient&apos;s portal</div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Instrument</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
              >
                {INSTRUMENTS.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} · {i.estimated_minutes} min
                  </option>
                ))}
              </select>
            </div>
            <button onClick={() => setMode('idle')} className="text-xs text-gray-600 px-3 py-1.5">Cancel</button>
            <button
              onClick={assignToPatient}
              disabled={working}
              className="text-xs bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50"
            >
              {working ? 'Assigning…' : 'Assign'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            The patient sees this on their portal next time they sign in. Auto-scored on submit. Alerts fire immediately.
          </p>
        </div>
      )}

      {/* Record manual score */}
      {mode === 'record' && (
        <form onSubmit={submitManualScore} className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="grid grid-cols-[1fr_1fr_2fr] gap-2 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Instrument</label>
              <select value={formType} onChange={(e) => setFormType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                {INSTRUMENTS.map((i) => <option key={i.id} value={i.id}>{i.id}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Score (0–{getInstrument(formType)?.max_score ?? 99})
              </label>
              <input type="number" min={0} max={getInstrument(formType)?.max_score ?? 99}
                value={formScore} onChange={(e) => setFormScore(e.target.value)} required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
              <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setMode('idle')} className="px-3 py-1.5 text-xs text-gray-600">Cancel</button>
            <button type="submit" disabled={working}
              className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded-md disabled:opacity-50">
              {working ? 'Saving…' : 'Save assessment'}
            </button>
          </div>
        </form>
      )}

      {/* No data */}
      {typesWithData.length === 0 && pending.length === 0 && (
        <p className="text-sm text-gray-500">
          No assessments on file. Click <strong>Assign to patient</strong> to send one to the portal, or <strong>Record in-session</strong> to enter a score manually.
        </p>
      )}

      {/* Charts per instrument */}
      <div className="space-y-5">
        {typesWithData.map((t) => (
          <InstrumentPanel
            key={t}
            type={t}
            data={byType.get(t)!}
            onInterpret={() => interpret(t)}
            interpreting={interpreting === t}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-instrument panel: chart + item breakdown + alerts + interpretation
// ---------------------------------------------------------------------------

function InstrumentPanel({ type, data, onInterpret, interpreting }: {
  type: string
  data: Assessment[]
  onInterpret: () => void
  interpreting: boolean
}) {
  const inst = getInstrument(type)
  const latest = data[data.length - 1]
  const first = data[0]
  const delta = latest && first ? (latest.score! - first.score!) : 0
  const [breakdownOpen, setBreakdownOpen] = useState(false)

  const hasItemLevel = latest?.responses_json && Object.keys(latest.responses_json).length > 0
  const alerts = latest?.alerts_triggered ?? []
  const hasAlerts = Array.isArray(alerts) && alerts.length > 0

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{inst?.name ?? type}</span>
          {hasAlerts && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              <AlertTriangle className="w-3 h-3" />
              Risk flag
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
          <span>
            {data.length} reading{data.length === 1 ? '' : 's'} · latest{' '}
            <strong className="text-gray-900">{latest.score}</strong>/{inst?.max_score}
            {latest.severity && <span className="ml-1 text-gray-400">({latest.severity})</span>}
          </span>
          {data.length > 1 && (
            <span className={delta < 0 ? 'text-emerald-700' : delta > 0 ? 'text-red-700' : 'text-gray-500'}>
              {delta > 0 ? '+' : ''}{delta} since first
            </span>
          )}
          <button
            onClick={onInterpret}
            disabled={interpreting}
            className="inline-flex items-center gap-1 text-xs bg-white border border-teal-600 text-teal-700 px-2 py-1 rounded-md hover:bg-teal-50 disabled:opacity-50"
          >
            <Sparkles className="w-3 h-3" />
            {interpreting ? 'Thinking…' : 'Interpret with AI'}
          </button>
        </div>
      </div>

      {/* Risk flags */}
      {hasAlerts && (
        <div className="my-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-900">
          {(alerts as any[]).map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
              <div>
                <div className="font-semibold">{a.type.replace(/_/g, ' ')}</div>
                <div className="text-xs">{a.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <TrendChart inst={inst} data={data} />

      {/* Symptom breakdown */}
      {hasItemLevel && inst && (
        <div className="mt-2">
          <button
            onClick={() => setBreakdownOpen((v) => !v)}
            className="text-xs text-teal-700 hover:text-teal-900 font-medium inline-flex items-center gap-1"
          >
            {breakdownOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Symptom breakdown (most recent)
          </button>
          {breakdownOpen && (
            <div className="mt-2 space-y-1 pl-4 border-l-2 border-gray-100">
              {inst.questions.map((q) => {
                const v = (latest.responses_json as any)?.[q.id] ?? 0
                const maxOpt = q.options[q.options.length - 1].value
                const pct = (v / maxOpt) * 100
                return (
                  <div key={q.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-700 truncate flex-1">{q.text}</span>
                      <span className="font-mono font-semibold text-gray-900 shrink-0">{v}/{maxOpt}</span>
                    </div>
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden mt-0.5">
                      <div
                        className={`h-full rounded-full ${v === 0 ? 'bg-emerald-400' : v === 1 ? 'bg-amber-400' : v === 2 ? 'bg-orange-500' : 'bg-red-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* AI Interpretation */}
      {latest?.interpretation && (
        <div className="mt-3 bg-teal-50 border border-teal-200 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-teal-800 mb-1">
            <Sparkles className="w-3 h-3" />
            AI interpretation
            {latest.interpretation_generated_at && (
              <span className="font-normal normal-case tracking-normal text-teal-600">
                · {new Date(latest.interpretation_generated_at).toLocaleDateString()}
              </span>
            )}
          </div>
          <div className="text-sm text-teal-900 whitespace-pre-wrap leading-relaxed">
            {latest.interpretation}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chart — same shape as before, now takes the full Instrument so bands are
// sourced from the library instead of hard-coded per type.
// ---------------------------------------------------------------------------

function TrendChart({ inst, data }: { inst: ReturnType<typeof getInstrument>; data: Assessment[] }) {
  const max = inst?.max_score ?? Math.max(...data.map((d) => d.score ?? 0), 10)

  const W = 560, H = 110, PAD_L = 32, PAD_R = 8, PAD_T = 8, PAD_B = 20
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  const points = data.map((d, i) => {
    const x = PAD_L + (data.length === 1 ? innerW / 2 : (innerW * i) / (data.length - 1))
    const y = PAD_T + innerH - (innerH * (d.score ?? 0)) / max
    return { x, y, d }
  })
  const path = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ')

  const first = data[0]
  const latest = data[data.length - 1]

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH} stroke="#e5e7eb" strokeWidth={1} />
      <line x1={PAD_L} y1={PAD_T + innerH} x2={W - PAD_R} y2={PAD_T + innerH} stroke="#e5e7eb" strokeWidth={1} />
      <text x={PAD_L - 4} y={PAD_T + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{max}</text>
      <text x={PAD_L - 4} y={PAD_T + innerH} textAnchor="end" fontSize={10} fill="#9ca3af">0</text>
      {/* Severity bands from the instrument itself */}
      {inst?.bands.map((b, i) => {
        const yTop = PAD_T + innerH - (innerH * b.max) / max
        const yBot = PAD_T + innerH - (innerH * b.min) / max
        const color = b.color === 'green' ? '#ecfdf5'
          : b.color === 'amber' ? '#fef3c7'
          : b.color === 'orange' ? '#fed7aa'
          : '#fecaca'
        return <rect key={i} x={PAD_L} y={yTop} width={innerW} height={yBot - yTop} fill={color} opacity={0.45} />
      })}
      <path d={path} fill="none" stroke="#0d9488" strokeWidth={2} strokeLinejoin="round" />
      {points.map((p, i) => {
        const hasAlert = Array.isArray(p.d.alerts_triggered) && p.d.alerts_triggered.length > 0
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={hasAlert ? 5 : 3.5}
              fill={hasAlert ? '#dc2626' : '#0d9488'}
              stroke={hasAlert ? '#fef2f2' : 'none'}
              strokeWidth={hasAlert ? 2 : 0}
            />
            <title>
              {p.d.completed_at ? new Date(p.d.completed_at).toLocaleDateString() : ''} — {p.d.score}{p.d.severity ? ` (${p.d.severity})` : ''}
              {hasAlert ? ' — RISK FLAG' : ''}
            </title>
          </g>
        )
      })}
      <text x={PAD_L} y={H - 4} fontSize={10} fill="#9ca3af">
        {first.completed_at ? new Date(first.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
      </text>
      {data.length > 1 && (
        <text x={W - PAD_R} y={H - 4} textAnchor="end" fontSize={10} fill="#9ca3af">
          {latest.completed_at ? new Date(latest.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
        </text>
      )}
    </svg>
  )
}

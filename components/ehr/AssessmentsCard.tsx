// components/ehr/AssessmentsCard.tsx
// Shows a line chart per instrument (PHQ-9, GAD-7, PHQ-2, GAD-2, etc.)
// plus a compact "record a new assessment" form. Pure SVG, no deps.

'use client'

import { useEffect, useState } from 'react'
import { Activity, Plus } from 'lucide-react'

type Assessment = {
  id: string
  assessment_type: string
  score: number
  severity: string | null
  completed_at: string | null
  created_at: string
}

const MAX_SCORE: Record<string, number> = {
  'PHQ-9': 27, 'PHQ9': 27,
  'GAD-7': 21, 'GAD7': 21,
  'PHQ-2': 6, 'PHQ2': 6,
  'GAD-2': 6, 'GAD2': 6,
}

const KNOWN_TYPES = ['PHQ-9', 'GAD-7', 'PHQ-2', 'GAD-2']

export function AssessmentsCard({ patientId }: { patientId: string }) {
  const [items, setItems] = useState<Assessment[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formType, setFormType] = useState('PHQ-9')
  const [formScore, setFormScore] = useState<string>('')
  const [formNotes, setFormNotes] = useState('')

  async function load() {
    try {
      const res = await fetch(`/api/ehr/assessments?patient_id=${encodeURIComponent(patientId)}`)
      if (res.status === 403) { setEnabled(false); return }
      const json = await res.json()
      setItems(json.assessments || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [patientId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const score = parseInt(formScore, 10)
    if (isNaN(score) || score < 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/ehr/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          assessment_type: formType,
          score,
          notes: formNotes || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setFormOpen(false)
      setFormScore('')
      setFormNotes('')
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed')
    } finally { setSaving(false) }
  }

  if (!enabled || loading) return null

  // Bucket by instrument type; normalize common variants
  function normalizeType(t: string): string {
    const up = (t || '').toUpperCase().replace(/[^A-Z0-9-]/g, '')
    if (up === 'PHQ9' || up === 'PHQ-9') return 'PHQ-9'
    if (up === 'GAD7' || up === 'GAD-7') return 'GAD-7'
    if (up === 'PHQ2' || up === 'PHQ-2') return 'PHQ-2'
    if (up === 'GAD2' || up === 'GAD-2') return 'GAD-2'
    return t
  }

  const byType = new Map<string, Assessment[]>()
  for (const a of items || []) {
    const k = normalizeType(a.assessment_type)
    if (!byType.has(k)) byType.set(k, [])
    byType.get(k)!.push(a)
  }

  const typesWithData = Array.from(byType.keys()).filter((k) => (byType.get(k)?.length ?? 0) > 0)

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-500" />
          Assessments &amp; Outcomes
        </h2>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-sm bg-teal-600 text-white px-3 py-1.5 rounded-md hover:bg-teal-700 transition"
        >
          <Plus className="w-3.5 h-3.5" />
          Record
        </button>
      </div>

      {formOpen && (
        <form onSubmit={submit} className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="grid grid-cols-[1fr_1fr_2fr] gap-2 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Instrument</label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {KNOWN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Score {MAX_SCORE[formType] ? `(0–${MAX_SCORE[formType]})` : ''}
              </label>
              <input
                type="number"
                min={0}
                max={MAX_SCORE[formType] ?? 99}
                value={formScore}
                onChange={(e) => setFormScore(e.target.value)}
                required
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
              <input
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Administered in-session, etc."
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setFormOpen(false)}
              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded-md disabled:opacity-50">
              {saving ? 'Saving…' : 'Save assessment'}
            </button>
          </div>
        </form>
      )}

      {typesWithData.length === 0 ? (
        <p className="text-sm text-gray-500">
          No assessments on file. Record a PHQ-9 or GAD-7 to start tracking outcomes over time.
        </p>
      ) : (
        <div className="space-y-5">
          {typesWithData.map((t) => (
            <TrendChart key={t} type={t} data={byType.get(t)!} />
          ))}
        </div>
      )}
    </div>
  )
}

function TrendChart({ type, data }: { type: string; data: Assessment[] }) {
  const max = MAX_SCORE[type] ?? Math.max(...data.map((d) => d.score), 10)
  const latest = data[data.length - 1]
  const first = data[0]
  const delta = latest && first ? latest.score - first.score : 0

  // Layout
  const W = 560, H = 110, PAD_L = 32, PAD_R = 8, PAD_T = 8, PAD_B = 20
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  const points = data.map((d, i) => {
    const x = PAD_L + (data.length === 1 ? innerW / 2 : (innerW * i) / (data.length - 1))
    const y = PAD_T + innerH - (innerH * d.score) / max
    return { x, y, d }
  })

  const path = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ')

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-sm font-medium text-gray-900">{type}</div>
        <div className="text-xs text-gray-500">
          {data.length} reading{data.length === 1 ? '' : 's'} · latest <strong className="text-gray-900">{latest.score}</strong>/{max}
          {latest.severity && <span className="ml-1 text-gray-400">({latest.severity})</span>}
          {data.length > 1 && (
            <span className={`ml-2 ${delta < 0 ? 'text-emerald-700' : delta > 0 ? 'text-red-700' : 'text-gray-500'}`}>
              {delta > 0 ? '+' : ''}{delta} since first
            </span>
          )}
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {/* Axis lines */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH} stroke="#e5e7eb" strokeWidth={1} />
        <line x1={PAD_L} y1={PAD_T + innerH} x2={W - PAD_R} y2={PAD_T + innerH} stroke="#e5e7eb" strokeWidth={1} />
        {/* Y axis labels (0, max) */}
        <text x={PAD_L - 4} y={PAD_T + 4} textAnchor="end" fontSize={10} fill="#9ca3af">{max}</text>
        <text x={PAD_L - 4} y={PAD_T + innerH} textAnchor="end" fontSize={10} fill="#9ca3af">0</text>
        {/* Severity bands for PHQ-9/GAD-7 */}
        {renderSeverityBands(type, max, innerW, innerH, PAD_L, PAD_T)}
        {/* Line */}
        <path d={path} fill="none" stroke="#0d9488" strokeWidth={2} strokeLinejoin="round" />
        {/* Dots */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.5} fill="#0d9488" />
            <title>
              {formatDate(p.d.completed_at || p.d.created_at)} — {p.d.score}{p.d.severity ? ` (${p.d.severity})` : ''}
            </title>
          </g>
        ))}
        {/* X axis dates — show first + last */}
        <text x={PAD_L} y={H - 4} fontSize={10} fill="#9ca3af">
          {formatDateShort(first.completed_at || first.created_at)}
        </text>
        {data.length > 1 && (
          <text x={W - PAD_R} y={H - 4} textAnchor="end" fontSize={10} fill="#9ca3af">
            {formatDateShort(latest.completed_at || latest.created_at)}
          </text>
        )}
      </svg>
    </div>
  )
}

function renderSeverityBands(type: string, max: number, w: number, h: number, x0: number, y0: number) {
  // Shaded bands in the background so therapists see severity at a glance.
  let bands: Array<{ from: number; to: number; color: string; label: string }> = []
  if (type === 'PHQ-9') {
    bands = [
      { from: 0,  to: 5,  color: '#ecfdf5', label: 'minimal' },
      { from: 5,  to: 10, color: '#fef3c7', label: 'mild' },
      { from: 10, to: 15, color: '#fed7aa', label: 'moderate' },
      { from: 15, to: 20, color: '#fecaca', label: 'mod-severe' },
      { from: 20, to: 27, color: '#fca5a5', label: 'severe' },
    ]
  } else if (type === 'GAD-7') {
    bands = [
      { from: 0,  to: 5,  color: '#ecfdf5', label: 'minimal' },
      { from: 5,  to: 10, color: '#fef3c7', label: 'mild' },
      { from: 10, to: 15, color: '#fed7aa', label: 'moderate' },
      { from: 15, to: 21, color: '#fecaca', label: 'severe' },
    ]
  } else {
    return null
  }
  return bands.map((b, i) => {
    const yTop = y0 + h - (h * b.to) / max
    const yBot = y0 + h - (h * b.from) / max
    return <rect key={i} x={x0} y={yTop} width={w} height={yBot - yTop} fill={b.color} opacity={0.45} />
  })
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso); if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatDateShort(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso); if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

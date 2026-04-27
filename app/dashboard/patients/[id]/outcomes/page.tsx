'use client'

// Wave 41 / T3 — patient outcomes deep-dive page.
//
// Line charts of every instrument's history with severity-band
// backgrounds + clinical-threshold reference lines (mean, mean±SD,
// reliable-change relative to baseline). Wave 31's TrajectoryBlock
// on the patient detail page stays as the at-a-glance sparkline;
// this is the deeper view.
//
// Date range is configurable (default 12 months). Server-side audit
// fires on every load via patient.outcomes.viewed.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Calendar } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceArea, ReferenceLine, Legend,
} from 'recharts'

interface SeverityBand {
  label: string
  min: number
  max: number
  color: string
}

interface Norm {
  instrument: string
  population: string
  mean: number
  sd: number
  reliable_change: number
  mcid: number
  source: string
}

interface InstrumentSeries {
  instrument: string
  points: Array<{ id: string; score: number; severity: string | null; completed_at: string }>
  max_score: number | null
  severity_bands: SeverityBand[]
  norm: Norm | null
}

interface OutcomesData {
  patient: { id: string; first_name: string | null; last_name: string | null }
  range: { from: string; to: string }
  series: InstrumentSeries[]
  norms: Norm[]
}

const RANGE_PRESETS = [
  { label: '3 mo', months: 3 },
  { label: '6 mo', months: 6 },
  { label: '12 mo', months: 12 },
  { label: '24 mo', months: 24 },
  { label: 'All', months: 120 },
]

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export default function PatientOutcomesPage() {
  const params = useParams()
  const patientId = String(params.id)

  const [data, setData] = useState<OutcomesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [months, setMonths] = useState(12)

  async function load(monthsLookback: number) {
    setLoading(true)
    setError(null)
    try {
      const to = new Date()
      const from = new Date(to.getTime() - monthsLookback * 30 * 24 * 60 * 60 * 1000)
      const qs = new URLSearchParams({ from: dateOnly(from), to: dateOnly(to) }).toString()
      const res = await fetch(`/api/ehr/patients/${patientId}/outcomes?${qs}`, { credentials: 'include' })
      if (!res.ok) {
        setError(`Could not load outcomes (${res.status})`)
        return
      }
      setData(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(months) }, [patientId, months])

  return (
    <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
      <div className="px-1">
        <Link
          href={`/dashboard/patients/${patientId}`}
          className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-800"
          style={{ minHeight: 44 }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to patient
        </Link>
      </div>

      <div className="flex items-center justify-between mt-3 mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Outcomes</h1>
          {data?.patient && (
            <p className="text-sm text-gray-500 mt-0.5">
              {[data.patient.first_name, data.patient.last_name].filter(Boolean).join(' ')}
              {data.range && (
                <span className="ml-1">
                  · {new Date(data.range.from).toLocaleDateString()} → {new Date(data.range.to).toLocaleDateString()}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          <Calendar className="w-4 h-4 text-gray-400 mx-1" />
          {RANGE_PRESETS.map((r) => (
            <button
              key={r.months}
              onClick={() => setMonths(r.months)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md ${
                months === r.months
                  ? 'bg-teal-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              style={{ minHeight: 32 }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data || data.series.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500">
            No completed assessments in this range. Trajectories will populate as
            instruments are administered.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {data.series.map((s) => (
            <InstrumentChart key={s.instrument} series={s} />
          ))}
        </div>
      )}
    </main>
  )
}

function InstrumentChart({ series }: { series: InstrumentSeries }) {
  // Map points to chart-friendly shape: x is a millisecond timestamp
  // so XAxis can render dates correctly.
  const chartData = series.points.map((p) => ({
    t: new Date(p.completed_at).getTime(),
    score: p.score,
    severity: p.severity,
    date: new Date(p.completed_at).toLocaleDateString(),
  }))

  const yMax = series.max_score ?? Math.max(...chartData.map((d) => d.score), 10)
  const norm = series.norm
  const baseline = chartData[0]?.score ?? null
  const reliableChangeUpper = norm && baseline != null ? baseline + norm.reliable_change : null
  const reliableChangeLower = norm && baseline != null ? baseline - norm.reliable_change : null

  // Compute interpretation chips for the current trajectory.
  const latest = chartData[chartData.length - 1]
  const interpretations: Array<{ label: string; tone: 'good' | 'bad' | 'neutral' }> = []
  if (norm && baseline != null && latest && chartData.length > 1) {
    const delta = latest.score - baseline
    if (Math.abs(delta) >= norm.reliable_change) {
      if (delta < 0) interpretations.push({ label: `Reliable improvement (Δ ${delta})`, tone: 'good' })
      else interpretations.push({ label: `Reliable worsening (Δ +${delta})`, tone: 'bad' })
    }
    if (Math.abs(delta) >= norm.mcid && delta < 0) {
      interpretations.push({ label: 'Above MCID', tone: 'good' })
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-baseline justify-between mb-1 gap-3 flex-wrap">
        <h2 className="text-base font-semibold text-gray-900">{series.instrument}</h2>
        <div className="flex items-center gap-1.5 flex-wrap">
          {interpretations.map((i) => (
            <span
              key={i.label}
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                i.tone === 'good' ? 'bg-green-100 text-green-800' :
                i.tone === 'bad'  ? 'bg-red-100 text-red-800' :
                                     'bg-gray-100 text-gray-700'
              }`}
            >
              {i.label}
            </span>
          ))}
          {latest && (
            <span className="text-xs text-gray-500">
              latest: <span className="font-semibold text-gray-900">{latest.score}</span>
            </span>
          )}
        </div>
      </div>

      {norm && (
        <p className="text-xs text-gray-500 mb-2">
          Pop. mean {norm.mean} ± {norm.sd} (SD). Reliable change ≥ {norm.reliable_change}, MCID {norm.mcid}.
        </p>
      )}

      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#f3f4f6" />
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}
              fontSize={11}
            />
            <YAxis domain={[0, yMax]} fontSize={11} />

            {/* Severity bands rendered as background shading. */}
            {series.severity_bands.map((b) => (
              <ReferenceArea
                key={b.label}
                y1={b.min}
                y2={b.max}
                fill={b.color}
                fillOpacity={0.5}
                stroke="none"
                ifOverflow="hidden"
                label={{ value: b.label, position: 'insideTopLeft', fontSize: 9, fill: '#6b7280' }}
              />
            ))}

            {/* Population mean reference line. */}
            {norm && (
              <ReferenceLine
                y={norm.mean}
                stroke="#6b7280"
                strokeDasharray="3 3"
                label={{ value: `pop. mean ${norm.mean}`, position: 'right', fontSize: 10, fill: '#6b7280' }}
              />
            )}

            {/* Reliable-change band relative to baseline (only meaningful with ≥2 points). */}
            {chartData.length > 1 && reliableChangeUpper != null && (
              <ReferenceLine
                y={reliableChangeUpper}
                stroke="#dc2626"
                strokeDasharray="2 4"
                label={{ value: 'reliable worsening', position: 'right', fontSize: 9, fill: '#dc2626' }}
              />
            )}
            {chartData.length > 1 && reliableChangeLower != null && reliableChangeLower >= 0 && (
              <ReferenceLine
                y={reliableChangeLower}
                stroke="#16a34a"
                strokeDasharray="2 4"
                label={{ value: 'reliable improvement', position: 'right', fontSize: 9, fill: '#16a34a' }}
              />
            )}

            <Tooltip
              labelFormatter={(t) => new Date(Number(t)).toLocaleString(undefined, {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
              formatter={(value: any, _key: any, item: any) => {
                const sev = item?.payload?.severity
                return [`${value}${sev ? ` (${sev})` : ''}`, 'Score']
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="score"
              name={series.instrument}
              stroke="#0d9488"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-gray-400 mt-2">
        {series.points.length} data point{series.points.length === 1 ? '' : 's'}.
        {norm ? ` Source: ${norm.source}.` : ''}
      </p>
    </div>
  )
}

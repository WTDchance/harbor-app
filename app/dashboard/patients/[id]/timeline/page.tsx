// app/dashboard/patients/[id]/timeline/page.tsx
//
// W46 T1 — patient timeline. Top: weekly density sparkline color-coded
// by category. Tap a week to expand the events for that period below.
// Above the timeline: AI 'since last session' summary on demand.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type Category = 'clinical' | 'communication' | 'billing' | 'admin'

type Bucket = { week_start: string } & Record<Category, number>
type TimelineEvent = {
  id: string
  occurred_at: string
  category: Category
  kind: string
  title: string
  detail?: string | null
  weight: 1 | 2 | 3 | 4 | 5
  link?: string | null
}

type TimelineResponse = {
  from: string
  to: string
  buckets: Bucket[]
  events: TimelineEvent[]
}

const CATEGORY_LABEL: Record<Category, string> = {
  clinical: 'Clinical',
  communication: 'Communications',
  billing: 'Billing',
  admin: 'Admin',
}
const CATEGORY_COLOR: Record<Category, string> = {
  clinical: '#52bfc0',
  communication: '#9ca3af',
  billing: '#1f375d',
  admin: '#e5e7eb',
}

const FILTER_STORAGE_KEY = 'patient_timeline_categories_v1'

export default function PatientTimelinePage() {
  const params = useParams<{ id: string }>()
  const patientId = params?.id as string

  const [data, setData] = useState<TimelineResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeWeek, setActiveWeek] = useState<string | null>(null)

  // Per-therapist saved category filters (localStorage; survives page
  // navigation. A future PR moves this into the user-prefs JSONB).
  const [categories, setCategories] = useState<Category[]>(() => {
    if (typeof window === 'undefined') return ['clinical','communication','billing','admin']
    try {
      const v = window.localStorage.getItem(FILTER_STORAGE_KEY)
      if (!v) return ['clinical','communication','billing','admin']
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed : ['clinical','communication','billing','admin']
    } catch { return ['clinical','communication','billing','admin'] }
  })

  // AI summary on demand.
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      sp.set('categories', categories.join(','))
      const res = await fetch(`/api/ehr/patients/${patientId}/timeline?${sp.toString()}`)
      if (!res.ok) throw new Error('Failed to load timeline')
      const j = (await res.json()) as TimelineResponse
      setData(j)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { if (patientId) void load() }, [patientId, categories.join(',')])

  function toggleCategory(c: Category) {
    const next = categories.includes(c)
      ? categories.filter((x) => x !== c)
      : [...categories, c]
    setCategories(next)
    try { window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(next)) } catch {}
    fetch(`/api/ehr/patients/${patientId}/timeline?categories=${next.join(',')}&audit=filter`)
      .catch(() => {})
  }

  async function generateSummary() {
    setSummaryLoading(true)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/since-last-session-summary`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Summary failed')
      const j = await res.json()
      setSummary(j.summary)
    } catch (e) {
      setSummary(`Couldn't generate summary: ${(e as Error).message}`)
    } finally {
      setSummaryLoading(false)
    }
  }

  // Maxes per bucket for sparkline scaling.
  const maxBucketTotal = useMemo(() => {
    if (!data) return 1
    return Math.max(1, ...data.buckets.map((b) => b.clinical + b.communication + b.billing + b.admin))
  }, [data])

  const eventsForActiveWeek = useMemo(() => {
    if (!data || !activeWeek) return []
    const weekEnd = new Date(activeWeek)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)
    return data.events.filter((e) => {
      const t = new Date(e.occurred_at).getTime()
      return t >= new Date(activeWeek).getTime() && t < weekEnd.getTime()
    })
  }, [data, activeWeek])

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Timeline</h1>
        <p className="text-sm text-gray-600 mt-1">
          The last 12 months of this chart, weighted by clinical importance.
          Tap a week to see what happened.
        </p>
      </div>

      {/* AI since-last-session */}
      <div className="rounded border bg-white p-3">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium flex-1">Since last session</div>
          <button
            onClick={generateSummary}
            disabled={summaryLoading}
            className="text-xs bg-[#1f375d] text-white px-2 py-1 rounded disabled:opacity-50"
          >
            {summary ? 'Regenerate' : (summaryLoading ? 'Generating…' : 'Generate')}
          </button>
        </div>
        {summary && (
          <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{summary}</p>
        )}
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 flex-wrap">
        {(['clinical','communication','billing','admin'] as Category[]).map((c) => {
          const on = categories.includes(c)
          return (
            <button
              key={c}
              onClick={() => toggleCategory(c)}
              className={`text-xs px-2 py-1 rounded-full border ${on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300'}`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                style={{ backgroundColor: CATEGORY_COLOR[c] }}
              />
              {CATEGORY_LABEL[c]}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Weekly density sparkline */}
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !data || data.buckets.length === 0 ? (
        <p className="text-sm text-gray-500">No events in the selected categories.</p>
      ) : (
        <div className="bg-white rounded border p-2">
          <div className="flex items-end gap-px h-20">
            {data.buckets.map((b) => {
              const total = b.clinical + b.communication + b.billing + b.admin
              const isActive = activeWeek === b.week_start
              return (
                <button
                  key={b.week_start}
                  onClick={() => setActiveWeek(b.week_start === activeWeek ? null : b.week_start)}
                  title={`Week of ${b.week_start}: ${total} events`}
                  className={`flex-1 flex flex-col-reverse rounded-sm hover:opacity-80 ${isActive ? 'ring-2 ring-[#1f375d]' : ''}`}
                  style={{ minWidth: 4 }}
                >
                  {(['clinical','communication','billing','admin'] as Category[]).map((c) => {
                    const h = (b[c] / maxBucketTotal) * 80
                    if (h <= 0) return null
                    return (
                      <div
                        key={c}
                        style={{ height: `${h}px`, backgroundColor: CATEGORY_COLOR[c] }}
                      />
                    )
                  })}
                </button>
              )
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>{data.from}</span>
            <span>{data.to}</span>
          </div>
        </div>
      )}

      {/* Expanded events for the active week */}
      {activeWeek && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-700">
            Week of {new Date(activeWeek).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </h2>
          {eventsForActiveWeek.length === 0 ? (
            <p className="text-sm text-gray-500">No events that week.</p>
          ) : (
            <ul className="space-y-2">
              {eventsForActiveWeek.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function EventRow({ event: e }: { event: TimelineEvent }) {
  // Weight 5 = full card; 1 = muted single line; 2-4 in between.
  const dateLabel = new Date(e.occurred_at).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

  if (e.weight >= 4) {
    return (
      <li className="border rounded bg-white p-3">
        <div className="text-xs text-gray-500">{dateLabel}</div>
        <div className="font-medium text-sm capitalize">{e.title}</div>
        {e.detail && <div className="text-xs text-gray-600 mt-0.5">{e.detail}</div>}
        {e.link && (
          <Link href={e.link} className="text-xs text-[#1f375d] hover:underline">Open →</Link>
        )}
      </li>
    )
  }
  if (e.weight === 1) {
    return (
      <li className="text-xs text-gray-400 px-2 py-1">
        <span>{dateLabel}</span> · <span>{e.title}</span>
      </li>
    )
  }
  return (
    <li className="border-l-2 px-3 py-1.5 bg-white" style={{ borderColor: '#9ca3af' }}>
      <div className="text-xs text-gray-500">{dateLabel}</div>
      <div className="text-sm capitalize">{e.title}{e.detail ? ` · ${e.detail}` : ''}</div>
    </li>
  )
}

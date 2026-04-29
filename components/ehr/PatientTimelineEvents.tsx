// components/ehr/PatientTimelineEvents.tsx
//
// W50 D4 — top 10 most-significant events from the last 30 days,
// ranked by computed relevance. Card layout, max ~80px tall.

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

interface Event {
  id: string
  occurred_at: string
  category: 'clinical' | 'communication' | 'billing' | 'admin'
  kind: string
  title: string
  detail?: string | null
  weight: 1 | 2 | 3 | 4 | 5
  link?: string | null
}

const CATEGORY_CLS: Record<Event['category'], string> = {
  clinical:      'bg-blue-50 border-blue-300 text-blue-800',
  communication: 'bg-emerald-50 border-emerald-300 text-emerald-800',
  billing:       'bg-amber-50 border-amber-300 text-amber-800',
  admin:         'bg-gray-50 border-gray-300 text-gray-700',
}

export default function PatientTimelineEvents({ patientId, days = 30, limit = 10 }: { patientId: string; days?: number; limit?: number }) {
  const [events, setEvents] = useState<Event[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const to = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    fetch(`/api/ehr/patients/${patientId}/timeline?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : { events: [] })
      .then(j => { if (!cancelled) setEvents(j.events ?? []) })
      .catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [patientId, days])

  // Relevance score = weight (1..5) × recency factor. Events in the
  // last 7 days score 1.0, decaying linearly to 0.3 by 30 days.
  const ranked = useMemo(() => {
    if (!events) return []
    const now = Date.now()
    return events
      .map(e => {
        const ageDays = Math.max(0, (now - new Date(e.occurred_at).getTime()) / 86_400_000)
        const recency = ageDays <= 7 ? 1 : Math.max(0.3, 1 - (ageDays - 7) / 23)
        const relevance = e.weight * recency
        return { ...e, relevance_score: relevance }
      })
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, limit)
  }, [events, limit])

  if (events === null) return <div className="text-sm text-gray-400">Loading…</div>
  if (ranked.length === 0) return <div className="text-sm text-gray-400">No recent activity.</div>

  return (
    <ul className="space-y-1.5">
      {ranked.map(e => {
        const date = new Date(e.occurred_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        const inner = (
          <div className="border border-gray-200 rounded-md px-3 py-2 hover:border-blue-400 transition flex items-center gap-3">
            <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border flex-shrink-0 ${CATEGORY_CLS[e.category]}`}>{e.category}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 truncate">{e.title}</div>
              {e.detail && <div className="text-xs text-gray-500 truncate">{e.detail}</div>}
            </div>
            <div className="text-xs text-gray-400 flex-shrink-0">{date}</div>
          </div>
        )
        return (
          <li key={e.id}>
            {e.link ? <Link href={e.link}>{inner}</Link> : inner}
          </li>
        )
      })}
    </ul>
  )
}

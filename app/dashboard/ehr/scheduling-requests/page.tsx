// app/dashboard/ehr/scheduling-requests/page.tsx
// Therapist inbox of patient scheduling requests. Approve picks a specific
// slot and creates the appointment; decline records a reason.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarPlus, Check, X } from 'lucide-react'

type Req = {
  id: string; patient_id: string; preferred_windows: Array<{ date: string; start: string; end: string }>
  patient_note: string | null; therapist_note: string | null; duration_minutes: number
  appointment_type: string; status: string; appointment_id: string | null; created_at: string
}

export default function SchedulingRequestsPage() {
  const [requests, setRequests] = useState<Req[] | null>(null)
  const [patients, setPatients] = useState<Map<string, any>>(new Map())
  const [processing, setProcessing] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')

  async function load() {
    const r = await fetch(`/api/ehr/scheduling-requests${filter === 'pending' ? '?status=pending' : ''}`)
    if (r.ok) setRequests((await r.json()).requests || [])
    const pr = await fetch('/api/practice/me')
    if (pr.ok) {
      const p = await pr.json()
      const r2 = await fetch(`/api/admin/patients?practice_id=${p.practice?.id}`)
      if (r2.ok) setPatients(new Map(((await r2.json()).patients || []).map((p: any) => [p.id, p])))
    }
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [filter])

  async function approve(req: Req, date: string, start: string) {
    const note = prompt('Confirmation note for the patient (optional)') ?? ''
    setProcessing(req.id)
    try {
      const r = await fetch(`/api/ehr/scheduling-requests/${req.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', appointment_date: date, appointment_time: start, note }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed')
      await load()
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setProcessing(null) }
  }

  async function decline(id: string) {
    const note = prompt('Tell the patient why (optional)')
    setProcessing(id)
    try {
      const r = await fetch(`/api/ehr/scheduling-requests/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline', note }),
      })
      if (!r.ok) throw new Error('Failed')
      await load()
    } finally { setProcessing(null) }
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <CalendarPlus className="w-6 h-6 text-teal-600" />
          Scheduling requests
        </h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)}
          className="border border-gray-200 rounded-lg px-2 py-1 text-sm">
          <option value="pending">Pending only</option>
          <option value="all">All</option>
        </select>
      </div>

      {requests === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-500">
          No requests to review.
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const pt = patients.get(req.patient_id)
            return (
              <div key={req.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    {pt ? (
                      <Link href={`/dashboard/patients/${req.patient_id}`} className="text-sm font-medium text-teal-700 hover:text-teal-900">
                        {pt.first_name} {pt.last_name}
                      </Link>
                    ) : <span className="text-sm font-medium">Patient</span>}
                    <div className="text-xs text-gray-500">
                      {req.duration_minutes} min · {req.appointment_type} · Submitted {new Date(req.created_at).toLocaleString()}
                    </div>
                  </div>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    req.status === 'approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : req.status === 'declined' ? 'bg-red-50 text-red-800 border-red-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}>{req.status}</span>
                </div>

                {req.patient_note && <div className="text-sm text-gray-700 mb-2 italic">&ldquo;{req.patient_note}&rdquo;</div>}

                <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Preferred times</div>
                <div className="space-y-1 mb-3">
                  {req.preferred_windows.map((w, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg p-2 text-sm">
                      <span>
                        {new Date(w.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' · '}{w.start} – {w.end}
                      </span>
                      {req.status === 'pending' && (
                        <button
                          onClick={() => approve(req, w.date, w.start)}
                          disabled={processing === req.id}
                          className="inline-flex items-center gap-1 text-xs bg-teal-600 hover:bg-teal-700 text-white px-2 py-1 rounded-md disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" />
                          Schedule
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {req.status === 'pending' && (
                  <button onClick={() => decline(req.id)} disabled={processing === req.id}
                    className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800">
                    <X className="w-3 h-3" />
                    Decline all
                  </button>
                )}

                {req.therapist_note && <div className="text-xs text-gray-500 mt-2">Your note: {req.therapist_note}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

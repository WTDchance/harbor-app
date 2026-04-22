// app/portal/schedule/page.tsx — patient requests an appointment.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Calendar, Plus, Trash2 } from 'lucide-react'

type Window = { date: string; start: string; end: string }
type Request = {
  id: string; preferred_windows: Window[]; patient_note: string | null
  therapist_note: string | null; duration_minutes: number
  appointment_type: string; status: string; created_at: string
  responded_at: string | null
}

export default function PortalSchedulePage() {
  const router = useRouter()
  const [requests, setRequests] = useState<Request[] | null>(null)
  const [windows, setWindows] = useState<Window[]>([{ date: '', start: '09:00', end: '17:00' }])
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const res = await fetch('/api/portal/scheduling')
    if (res.status === 401) { router.replace('/portal/login'); return }
    const json = await res.json()
    setRequests(json.requests || [])
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const cleaned = windows.filter((w) => w.date)
    if (cleaned.length === 0) { alert('Pick at least one date'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/portal/scheduling', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferred_windows: cleaned, note: note || null }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setWindows([{ date: '', start: '09:00', end: '17:00' }])
      setNote('')
      await load()
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setSubmitting(false) }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/portal/home" className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 mb-4">
        <ChevronLeft className="w-4 h-4" />
        Back to portal
      </Link>
      <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2 mb-2">
        <Calendar className="w-6 h-6 text-teal-600" />
        Request an appointment
      </h1>
      <p className="text-sm text-gray-500 mb-4">
        Tell your therapist which days and times work for you. They&apos;ll confirm with a specific slot.
      </p>

      <form onSubmit={submit} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        {windows.map((w, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
            <input type="date" value={w.date}
              onChange={(e) => { const n = [...windows]; n[i].date = e.target.value; setWindows(n) }}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
            <input type="time" value={w.start}
              onChange={(e) => { const n = [...windows]; n[i].start = e.target.value; setWindows(n) }}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
            <span className="text-xs text-gray-500">to</span>
            <input type="time" value={w.end}
              onChange={(e) => { const n = [...windows]; n[i].end = e.target.value; setWindows(n) }}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
            {windows.length > 1 && (
              <button type="button" onClick={() => setWindows(windows.filter((_, j) => j !== i))}
                className="col-span-4 justify-self-end text-xs text-gray-400 hover:text-red-600">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setWindows([...windows, { date: '', start: '09:00', end: '17:00' }])}
          className="text-xs text-teal-700 hover:text-teal-900 inline-flex items-center gap-1 font-medium">
          <Plus className="w-3 h-3" />
          Add another window
        </button>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
          placeholder="Anything your therapist should know (e.g. Zoom vs. in-person, topic)…"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <div className="flex justify-end">
          <button type="submit" disabled={submitting}
            className="inline-flex items-center gap-1.5 text-sm bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg disabled:opacity-50">
            {submitting ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </form>

      {requests && requests.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Your requests</h2>
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="text-sm font-medium text-gray-900">
                    {r.preferred_windows[0]?.date} {r.preferred_windows.length > 1 && ` +${r.preferred_windows.length - 1}`}
                  </div>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    r.status === 'approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : r.status === 'declined' ? 'bg-red-50 text-red-800 border-red-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}>{r.status}</span>
                </div>
                {r.patient_note && <div className="text-xs text-gray-600">{r.patient_note}</div>}
                {r.therapist_note && <div className="text-xs text-teal-800 mt-1">Therapist: {r.therapist_note}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

// Wave 43 / T0 — patient-facing booking page. Reads availability +
// books slots via the W42 T1 endpoints. Phone-first, ≥44px tap
// targets. 401 bounces to /portal/login.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Calendar, ChevronLeft, Check, AlertCircle } from 'lucide-react'

interface VisitType {
  key: string
  label: string
  duration_minutes: number
  modality: string
}
interface Slot { start: string; end: string }

export default function PortalSchedulePage() {
  const router = useRouter()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [visitTypes, setVisitTypes] = useState<VisitType[]>([])
  const [selectedVisit, setSelectedVisit] = useState<string>('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [picked, setPicked] = useState<Slot | null>(null)
  const [loading, setLoading] = useState(true)
  const [booking, setBooking] = useState(false)
  const [bookedAt, setBookedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      // Pull config first (visit types live on /me).
      const meRes = await fetch('/api/portal/me', { credentials: 'include' })
      if (meRes.status === 401) { router.replace('/portal/login'); return }
      const me = await meRes.json().catch(() => null)
      const cfg = me?.scheduling_config ?? {}
      setEnabled(!!cfg.enabled)
      const vts: VisitType[] = cfg.visit_types ?? []
      setVisitTypes(vts)
      if (vts.length > 0) setSelectedVisit(vts[0].key)
      setLoading(false)
    })()
  }, [router])

  useEffect(() => {
    if (!selectedVisit) return
    setSlots([]); setPicked(null); setError(null)
    fetch(`/api/portal/schedule/availability?visit_type=${encodeURIComponent(selectedVisit)}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data) => setSlots(data.slots ?? []))
      .catch((err) => setError(err.message))
  }, [selectedVisit])

  async function book() {
    if (!picked) return
    setBooking(true); setError(null)
    try {
      const res = await fetch('/api/portal/schedule/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visit_type: selectedVisit, start: picked.start }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error?.message || `Booking failed (${res.status})`)
        if (data?.error?.code === 'slot_taken') {
          // Refresh availability so the patient sees the new state.
          const r = await fetch(`/api/portal/schedule/availability?visit_type=${encodeURIComponent(selectedVisit)}`, { credentials: 'include' })
          if (r.ok) setSlots((await r.json()).slots ?? [])
          setPicked(null)
        }
        return
      }
      setBookedAt(picked.start)
    } finally {
      setBooking(false)
    }
  }

  if (loading) {
    return <main className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" /></main>
  }

  if (enabled === false) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <Link href="/portal/home" className="inline-flex items-center gap-1 text-sm text-teal-700" style={{ minHeight: 44 }}>
          <ChevronLeft className="w-4 h-4" /> Back
        </Link>
        <h1 className="text-2xl font-semibold mt-3">Booking</h1>
        <p className="text-sm text-gray-600 mt-3">
          Online booking isn't enabled for your therapist's practice. Reach out by phone or message
          and they'll get you scheduled.
        </p>
      </main>
    )
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <Link href="/portal/home" className="inline-flex items-center gap-1 text-sm text-teal-700" style={{ minHeight: 44 }}>
        <ChevronLeft className="w-4 h-4" /> Back to portal
      </Link>
      <h1 className="text-2xl font-semibold text-gray-900 mt-3 flex items-center gap-2">
        <Calendar className="w-6 h-6 text-teal-600" />
        Book a session
      </h1>

      {bookedAt && (
        <div className="mt-4 p-4 rounded-xl bg-green-50 border border-green-200">
          <div className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-700 mt-0.5" />
            <div>
              <div className="font-semibold text-green-900">Booked!</div>
              <div className="text-sm text-green-800 mt-0.5">
                {new Date(bookedAt).toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
              <Link href="/portal/home" className="inline-block mt-3 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg" style={{ minHeight: 44 }}>
                Done
              </Link>
            </div>
          </div>
        </div>
      )}

      {!bookedAt && (
        <>
          {visitTypes.length > 0 && (
            <div className="mt-4">
              <label className="block text-xs font-medium text-gray-700 mb-2">Visit type</label>
              <div className="flex gap-2 flex-wrap">
                {visitTypes.map((v) => (
                  <button key={v.key} onClick={() => setSelectedVisit(v.key)}
                    className={`px-3 py-2 text-sm rounded-lg border ${selectedVisit === v.key ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-200'}`}
                    style={{ minHeight: 44 }}>
                    {v.label} · {v.duration_minutes} min
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
            </div>
          )}

          <h2 className="text-sm font-semibold text-gray-700 mt-6 mb-2">Available times</h2>
          {slots.length === 0 ? (
            <p className="text-sm text-gray-500">No openings in the next few weeks. Try a different visit type or reach out to your therapist.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {slots.slice(0, 60).map((s) => {
                const isPicked = picked?.start === s.start
                const d = new Date(s.start)
                return (
                  <button key={s.start} onClick={() => setPicked(s)}
                    className={`px-3 py-3 text-sm rounded-lg border text-left ${isPicked ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-200 hover:border-teal-300'}`}
                    style={{ minHeight: 44 }}>
                    <div className="font-medium">{d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                    <div className={`text-xs ${isPicked ? 'text-teal-50' : 'text-gray-500'}`}>{d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
                  </button>
                )
              })}
            </div>
          )}

          {picked && (
            <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-3 z-30" style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}>
              <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
                <div className="text-sm text-gray-700">
                  <span className="text-gray-500 text-xs block">Selected</span>
                  {new Date(picked.start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </div>
                <button onClick={book} disabled={booking}
                  className="px-5 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg disabled:opacity-60" style={{ minHeight: 44 }}>
                  {booking ? 'Booking…' : 'Confirm booking'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  )
}

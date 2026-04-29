// app/portal/telehealth/[id]/waiting/page.tsx
//
// W49 D2 — patient waiting room. Polls /api/portal/telehealth/[id]/status
// every 4s; once therapist admits, swaps in the Jitsi/Chime iframe.

'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

interface SessionRow {
  id: string
  patient_status: 'invited' | 'in_waiting' | 'in_session' | 'left'
  therapist_status: 'not_arrived' | 'in_session' | 'left'
  therapist_message: string | null
  jitsi_room_id: string | null
  admitted_at: string | null
  ended_at: string | null
}

interface ApptRow {
  id: string
  scheduled_for: string
  video_provider: string | null
  video_meeting_id: string | null
}

export default function PortalWaitingRoomPage() {
  const params = useParams<{ id: string }>()
  const apptId = params.id
  const [session, setSession] = useState<SessionRow | null>(null)
  const [appt, setAppt] = useState<ApptRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const pollRef = useRef<number | null>(null)

  async function fetchStatus() {
    try {
      const res = await fetch(`/api/portal/telehealth/${apptId}/status`)
      const j = await res.json()
      if (res.ok) {
        setSession(j.session)
        setAppt(j.appointment ?? appt)
        setError(null)
      } else {
        setError(j.error || 'Could not load')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  async function checkIn() {
    setCheckingIn(true)
    try {
      const res = await fetch(`/api/portal/telehealth/${apptId}/check-in`, { method: 'POST' })
      const j = await res.json()
      if (res.ok) setSession(j.session)
      else setError(j.error || 'Check-in failed')
    } finally { setCheckingIn(false) }
  }

  useEffect(() => {
    void fetchStatus()
    pollRef.current = window.setInterval(fetchStatus, 4000) as unknown as number
    return () => { if (pollRef.current) window.clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apptId])

  if (loading) return <Shell><p className="text-sm text-gray-500">Loading…</p></Shell>
  if (error) return <Shell><p className="text-sm text-red-600">{error}</p></Shell>

  // Admitted → render the video iframe.
  if (session && session.patient_status === 'in_session' && session.jitsi_room_id) {
    const url = (appt?.video_provider === 'jitsi_public' || !appt?.video_provider)
      ? `https://meet.jit.si/${encodeURIComponent(session.jitsi_room_id)}`
      : `https://meet.jit.si/${encodeURIComponent(session.jitsi_room_id)}`
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <iframe
          src={url}
          allow="camera; microphone; fullscreen; display-capture"
          className="flex-1 w-full border-0"
          title="Telehealth session"
        />
      </div>
    )
  }

  if (session && session.ended_at) {
    return <Shell><h1 className="text-xl font-semibold">Session ended</h1>
      <p className="text-sm text-gray-600 mt-2">Thanks — you can close this tab.</p>
    </Shell>
  }

  // Not yet checked in.
  if (!session || session.patient_status === 'invited' || session.patient_status === 'left') {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-gray-900">Telehealth check-in</h1>
        {appt?.scheduled_for && (
          <p className="text-sm text-gray-600 mt-1">
            Scheduled for {new Date(appt.scheduled_for).toLocaleString()}.
          </p>
        )}
        <p className="text-sm text-gray-600 mt-3">
          When you're ready, check in below and your therapist will admit you when the session starts.
        </p>
        <button
          onClick={checkIn} disabled={checkingIn}
          className="mt-5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50"
        >
          {checkingIn ? 'Checking in…' : "I'm ready — check me in"}
        </button>
      </Shell>
    )
  }

  // In waiting room.
  return (
    <Shell>
      <div className="text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-blue-100 animate-pulse mb-4" />
        <h1 className="text-xl font-semibold text-gray-900">In the waiting room</h1>
        <p className="text-sm text-gray-600 mt-2">
          {session.therapist_status === 'in_session'
            ? "Your therapist is connecting…"
            : "Your therapist will admit you when they're ready."}
        </p>
        {session.therapist_message && (
          <div className="mt-5 mx-auto max-w-sm bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-900">
            <strong>Note from your therapist:</strong> {session.therapist_message}
          </div>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center px-4 py-12">
      <div className="max-w-lg w-full bg-white rounded-xl border border-gray-200 p-6">
        {children}
      </div>
    </div>
  )
}

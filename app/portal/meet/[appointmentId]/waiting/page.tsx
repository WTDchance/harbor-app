// app/portal/meet/[appointmentId]/waiting/page.tsx
//
// W47 T1 — patient waiting room. Shows practice + therapist + scheduled
// time, runs a small browser readiness checklist, polls every 5s for
// the therapist to join, then redirects into the meeting.

'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

type Appt = {
  id: string
  scheduled_for: string
  duration_minutes: number
  status: string
  waiting_room_entered_at: string | null
  therapist_joined_meeting_at: string | null
  therapist_first: string | null
  therapist_last: string | null
  practice_name: string | null
}

export default function PortalWaitingRoom() {
  const params = useParams<{ appointmentId: string }>()
  const apptId = params?.appointmentId as string
  const router = useRouter()

  const [appt, setAppt] = useState<Appt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraOk, setCameraOk] = useState<boolean | null>(null)
  const [micOk, setMicOk] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const enteredRef = useRef(false)

  // Initial load + record entered.
  useEffect(() => {
    if (!apptId || enteredRef.current) return
    enteredRef.current = true
    void (async () => {
      try {
        const res = await fetch(`/api/portal/meet/${apptId}/waiting`)
        if (!res.ok) throw new Error('appointment_not_found')
        const j = await res.json()
        setAppt(j.appointment)
        // Record entered (idempotent — server preserves first timestamp).
        fetch(`/api/portal/meet/${apptId}/waiting`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'entered' }),
        }).catch(() => {})
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [apptId])

  // Poll for therapist-joined every 5s.
  useEffect(() => {
    if (!apptId || !appt || appt.therapist_joined_meeting_at) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/portal/meet/${apptId}/waiting`)
        if (!res.ok) return
        const j = await res.json()
        if (j.appointment?.therapist_joined_meeting_at) {
          setAppt(j.appointment)
          clearInterval(interval)
          // Audit ping + redirect.
          fetch(`/api/portal/meet/${apptId}/waiting`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: 'joined_session' }),
          }).catch(() => {})
          router.push(`/portal/meet/${apptId}`)
        }
      } catch {}
    }, 5000)
    return () => clearInterval(interval)
  }, [apptId, appt, router])

  // Beforeunload handler: record abandoned if patient leaves before
  // therapist joins.
  useEffect(() => {
    function onUnload() {
      if (appt && !appt.therapist_joined_meeting_at) {
        navigator.sendBeacon(
          `/api/portal/meet/${apptId}/waiting`,
          new Blob([JSON.stringify({ event: 'abandoned' })], { type: 'application/json' }),
        )
      }
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [appt, apptId])

  async function checkPermissions() {
    setChecking(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      const videoTrack = stream.getVideoTracks()[0]
      const audioTrack = stream.getAudioTracks()[0]
      setCameraOk(!!videoTrack)
      setMicOk(!!audioTrack)
      stream.getTracks().forEach((t) => t.stop())
    } catch {
      setCameraOk(false); setMicOk(false)
    } finally { setChecking(false) }
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f5f9fb] to-[#eaf5f5]">
        <div className="rounded border bg-white p-6 max-w-md text-center">
          <p className="text-sm text-red-700">We couldn't load this appointment. Please refresh or contact your therapist.</p>
        </div>
      </div>
    )
  }
  if (!appt) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>
  }

  const therapistName = `${appt.therapist_first || ''} ${appt.therapist_last || ''}`.trim() || 'your therapist'
  const startsAt = new Date(appt.scheduled_for)
  const startStr = startsAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f5f9fb] to-[#eaf5f5] p-4">
      <div className="rounded-2xl bg-white shadow-md p-6 max-w-md w-full space-y-4 border border-gray-100">
        <div className="text-center space-y-1">
          <p className="text-xs uppercase tracking-wide text-gray-500">Welcome to</p>
          <h1 className="text-xl font-semibold" style={{ color: '#1f375d' }}>{appt.practice_name || 'Harbor'}</h1>
          <p className="text-sm text-gray-600">Your session with {therapistName} is at {startStr}.</p>
        </div>

        <div className="rounded-lg bg-gray-50 p-4 space-y-2">
          <h2 className="text-sm font-medium">Quick check before we begin</h2>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              <span className={cameraOk === true ? 'text-green-600' : cameraOk === false ? 'text-red-600' : 'text-gray-400'}>
                {cameraOk === true ? '✓' : cameraOk === false ? '✗' : '○'}
              </span>
              Camera
            </li>
            <li className="flex items-center gap-2">
              <span className={micOk === true ? 'text-green-600' : micOk === false ? 'text-red-600' : 'text-gray-400'}>
                {micOk === true ? '✓' : micOk === false ? '✗' : '○'}
              </span>
              Microphone
            </li>
            <li className="text-xs text-gray-500">Headphones recommended for the best audio.</li>
            <li className="text-xs text-gray-500">Use a recent Chrome / Firefox / Safari for best results.</li>
          </ul>
          <button onClick={checkPermissions} disabled={checking}
                  className="text-xs text-[#1f375d] hover:underline">
            {checking ? 'Checking…' : (cameraOk == null ? 'Test camera + mic' : 'Re-test')}
          </button>
        </div>

        <div className="text-center text-sm text-gray-600 italic">
          Take a moment to settle in. Your therapist will join shortly.
        </div>
      </div>
    </div>
  )
}

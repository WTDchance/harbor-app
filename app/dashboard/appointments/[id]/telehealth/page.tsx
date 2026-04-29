// app/dashboard/appointments/[id]/telehealth/page.tsx
//
// W49 D2 — therapist control panel. Start session, see waiting status,
// admit, message, end. Once admitted, embeds the same Jitsi iframe.

'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

interface SessionRow {
  id: string
  appointment_id: string
  patient_status: 'invited' | 'in_waiting' | 'in_session' | 'left'
  therapist_status: 'not_arrived' | 'in_session' | 'left'
  therapist_message: string | null
  jitsi_room_id: string | null
  started_at: string | null
  admitted_at: string | null
  ended_at: string | null
  video_provider?: string | null
  video_meeting_id?: string | null
  patient_first_name?: string
  patient_last_name?: string
  scheduled_for?: string
}

export default function TherapistTelehealthControlPage() {
  const params = useParams<{ id: string }>()
  const apptId = params.id
  const [session, setSession] = useState<SessionRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const pollRef = useRef<number | null>(null)

  async function startOrFetch() {
    setBusy(true)
    try {
      const res = await fetch(`/api/ehr/appointments/${apptId}/start-telehealth`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) { setError(j.error || 'Start failed'); return }
      setSession(j.session)
    } finally { setBusy(false) }
  }

  async function pollStatus(sessionId: string) {
    try {
      const res = await fetch(`/api/ehr/telehealth/${sessionId}/status`)
      const j = await res.json()
      if (res.ok) setSession((s) => s ? { ...s, ...j.session } : j.session)
    } catch {}
  }

  async function admit() {
    if (!session) return
    setBusy(true)
    try {
      const res = await fetch(`/api/ehr/telehealth/${session.id}/admit`, { method: 'POST' })
      const j = await res.json()
      if (res.ok) setSession((s) => s ? { ...s, ...j.session } : j.session)
      else setError(j.error || 'Admit failed')
    } finally { setBusy(false) }
  }

  async function end() {
    if (!session) return
    if (!confirm('End this session?')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/ehr/telehealth/${session.id}/end`, { method: 'POST' })
      const j = await res.json()
      if (res.ok) setSession((s) => s ? { ...s, ...j.session } : j.session)
    } finally { setBusy(false) }
  }

  async function sendMessage() {
    if (!session) return
    setBusy(true)
    try {
      const res = await fetch(`/api/ehr/telehealth/${session.id}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const j = await res.json()
      if (res.ok) setSession((s) => s ? { ...s, ...j.session } : j.session)
    } finally { setBusy(false) }
  }

  useEffect(() => { void startOrFetch() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [apptId])

  useEffect(() => {
    if (!session?.id || session.ended_at) return
    pollRef.current = window.setInterval(() => pollStatus(session.id), 3000) as unknown as number
    return () => { if (pollRef.current) window.clearInterval(pollRef.current) }
  }, [session?.id, session?.ended_at])

  if (!session) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        {error ? <div className="text-red-600 text-sm">{error}</div> : <div className="text-gray-500 text-sm">Starting session…</div>}
      </div>
    )
  }

  if (session.patient_status === 'in_session' && session.jitsi_room_id && !session.ended_at) {
    const url = `https://meet.jit.si/${encodeURIComponent(session.jitsi_room_id)}`
    return (
      <div className="min-h-screen flex flex-col bg-black">
        <div className="flex items-center justify-between px-3 py-2 bg-gray-900 text-white text-sm">
          <span>In session with {session.patient_first_name} {session.patient_last_name}</span>
          <button onClick={end} disabled={busy} className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded">End session</button>
        </div>
        <iframe src={url} allow="camera; microphone; fullscreen; display-capture" className="flex-1 w-full border-0" title="Telehealth" />
      </div>
    )
  }

  if (session.ended_at) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold">Session ended</h1>
        <p className="text-sm text-gray-600 mt-2">Ended at {new Date(session.ended_at).toLocaleString()}.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Telehealth — control panel</h1>
        <p className="text-sm text-gray-600 mt-1">
          {session.patient_first_name} {session.patient_last_name}
          {session.scheduled_for && ` · ${new Date(session.scheduled_for).toLocaleString()}`}
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <StatusDot status={session.patient_status} />
          <span className="text-sm">
            Patient: <strong className="text-gray-900">{labelPatient(session.patient_status)}</strong>
          </span>
        </div>

        {session.patient_status === 'in_waiting' && (
          <button onClick={admit} disabled={busy} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-md">
            Admit patient
          </button>
        )}

        {session.patient_status === 'invited' && (
          <p className="text-sm text-gray-500">Patient hasn't checked in yet. Once they tap "I'm ready" in the portal, you'll see them here.</p>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-2">
        <h2 className="text-sm font-medium text-gray-900">Message to patient (shown in their waiting room)</h2>
        <div className="flex gap-2">
          <input
            type="text" value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g., Running 5 minutes late"
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
          <button onClick={sendMessage} disabled={busy} className="text-sm border border-gray-300 hover:bg-gray-50 px-3 py-2 rounded-md">Send</button>
        </div>
        {session.therapist_message && (
          <p className="text-xs text-gray-500">Currently showing: “{session.therapist_message}”</p>
        )}
      </div>

      <div>
        <button onClick={end} disabled={busy} className="text-sm text-red-600 hover:text-red-700">End session</button>
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'in_session' ? 'bg-green-500'
    : status === 'in_waiting' ? 'bg-yellow-500'
    : status === 'left' ? 'bg-gray-400'
    : 'bg-gray-300'
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />
}

function labelPatient(s: string): string {
  switch (s) {
    case 'invited': return 'Not yet checked in'
    case 'in_waiting': return 'Waiting'
    case 'in_session': return 'In session'
    case 'left': return 'Left'
    default: return s
  }
}

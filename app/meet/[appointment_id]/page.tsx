// app/meet/[appointment_id]/page.tsx
//
// Wave 38 TS2 — Chime SDK telehealth room. Therapist or patient hits
// /meet/<id>, browser POSTs /api/ehr/appointments/<id>/telehealth/join
// to mint Meeting+Attendee, then connects via amazon-chime-sdk-js.
//
// HIPAA: Chime SDK Meetings is BAA-covered. The page's URL contains
// only the appointment uuid (an opaque internal id), not patient name.
//
// Recording is v2 -- not wired here.

'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Mic, MicOff, Video, VideoOff, PhoneOff, Loader2 } from 'lucide-react'
import { RecordingsList } from '@/components/meet/RecordingsList'

type JoinResponse = {
  Meeting: any
  Attendee: any
  role: 'therapist' | 'patient'
  error?: string
}

export default function MeetingPage() {
  const params = useParams<{ appointment_id: string }>()
  const apptId = params.appointment_id

  const [status, setStatus] = useState<'idle' | 'joining' | 'joined' | 'left' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [videoOn, setVideoOn] = useState(true)
  const [role, setRole] = useState<'therapist' | 'patient' | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideosRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<any>(null)

  async function join() {
    setStatus('joining')
    setError(null)
    try {
      // Lazy-load the SDK so SSR doesn't try to import its DOM bits.
      const ChimeSdk = await import('amazon-chime-sdk-js')
      const {
        ConsoleLogger,
        DefaultDeviceController,
        DefaultMeetingSession,
        LogLevel,
        MeetingSessionConfiguration,
      } = ChimeSdk as any

      const r = await fetch(`/api/ehr/appointments/${apptId}/telehealth/join`, {
        method: 'POST',
      })
      const j: JoinResponse = await r.json()
      if (!r.ok || !j.Meeting || !j.Attendee) {
        throw new Error(j.error || `join_failed (${r.status})`)
      }
      setRole(j.role)

      const logger = new ConsoleLogger('Harbor', LogLevel.WARN)
      const deviceController = new DefaultDeviceController(logger)
      const config = new MeetingSessionConfiguration(j.Meeting, j.Attendee)
      const session = new DefaultMeetingSession(config, logger, deviceController)
      sessionRef.current = session

      // Wire local audio output element (required by Chime SDK).
      if (audioRef.current) {
        await session.audioVideo.bindAudioElement(audioRef.current)
      }

      // Pick first available input devices.
      const audioInputs = await session.audioVideo.listAudioInputDevices()
      if (audioInputs[0]) {
        await session.audioVideo.startAudioInput(audioInputs[0].deviceId)
      }
      const videoInputs = await session.audioVideo.listVideoInputDevices()
      if (videoInputs[0]) {
        await session.audioVideo.startVideoInput(videoInputs[0].deviceId)
        if (localVideoRef.current) {
          await session.audioVideo.bindVideoElement(0, localVideoRef.current)
        }
      }

      // Tile observer — render remote videos
      session.audioVideo.addObserver({
        videoTileDidUpdate: (tile: any) => {
          if (!tile.boundAttendeeId || tile.localTile) return
          if (!remoteVideosRef.current) return
          let el = document.getElementById(`tile-${tile.tileId}`) as HTMLVideoElement | null
          if (!el) {
            el = document.createElement('video')
            el.id = `tile-${tile.tileId}`
            el.autoplay = true
            el.playsInline = true
            el.className = 'w-full h-full object-cover rounded-lg bg-black'
            remoteVideosRef.current.appendChild(el)
          }
          session.audioVideo.bindVideoElement(tile.tileId, el)
        },
        videoTileWasRemoved: (tileId: number) => {
          const el = document.getElementById(`tile-${tileId}`)
          if (el && el.parentNode) el.parentNode.removeChild(el)
        },
      })

      session.audioVideo.start()
      session.audioVideo.startLocalVideoTile()

      setStatus('joined')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join')
      setStatus('error')
    }
  }

  function leave() {
    try {
      sessionRef.current?.audioVideo?.stop()
    } catch {}
    sessionRef.current = null
    setStatus('left')
  }

  function toggleMute() {
    const av = sessionRef.current?.audioVideo
    if (!av) return
    if (muted) av.realtimeUnmuteLocalAudio()
    else av.realtimeMuteLocalAudio()
    setMuted(!muted)
  }
  async function toggleVideo() {
    const av = sessionRef.current?.audioVideo
    if (!av) return
    if (videoOn) {
      av.stopLocalVideoTile()
    } else {
      av.startLocalVideoTile()
    }
    setVideoOn(!videoOn)
  }

  useEffect(() => () => leave(), [])

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-400 uppercase tracking-wider">Telehealth session</div>
          <div className="text-sm font-medium">
            {role ? `Joined as ${role}` : `Appointment ${apptId.slice(0, 8)}`}
          </div>
        </div>
        {status === 'idle' && (
          <button
            onClick={join}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium min-h-[44px]"
          >
            Join session
          </button>
        )}
        {status === 'joining' && (
          <span className="inline-flex items-center gap-2 text-sm text-gray-300">
            <Loader2 className="w-4 h-4 animate-spin" /> Connecting…
          </span>
        )}
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
        <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
          <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          <span className="absolute bottom-2 left-2 text-xs bg-black/60 text-white px-2 py-0.5 rounded">You</span>
        </div>
        <div ref={remoteVideosRef} className="relative bg-black rounded-lg overflow-hidden aspect-video flex items-center justify-center text-gray-500 text-sm">
          {status === 'joined' ? 'Waiting for the other side…' : 'Not connected'}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-center gap-3">
        <button
          onClick={toggleMute}
          disabled={status !== 'joined'}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center bg-gray-800 hover:bg-gray-700 rounded-full p-3 disabled:opacity-50"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <MicOff className="w-5 h-5 text-red-400" /> : <Mic className="w-5 h-5" />}
        </button>
        <button
          onClick={toggleVideo}
          disabled={status !== 'joined'}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center bg-gray-800 hover:bg-gray-700 rounded-full p-3 disabled:opacity-50"
          aria-label={videoOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {videoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5 text-red-400" />}
        </button>
        <button
          onClick={leave}
          disabled={status === 'idle' || status === 'left'}
          className="min-h-[44px] inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-full disabled:opacity-50"
        >
          <PhoneOff className="w-4 h-4" /> Leave
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-900/50 text-red-200 text-sm">{error}</div>
      )}
      <div className="px-4 py-3 border-t border-gray-800">
        <RecordingsList appointmentId={apptId} />
      </div>
      <audio ref={audioRef} className="hidden" />
    </div>
  )
}

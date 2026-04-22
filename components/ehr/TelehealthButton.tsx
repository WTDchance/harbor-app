// components/ehr/TelehealthButton.tsx
// Per-appointment button. First click generates a unique room slug and
// opens the video call in a new tab. Subsequent clicks reuse the same
// slug so patient + therapist land in the same room.

'use client'

import { useState } from 'react'
import { Video } from 'lucide-react'

export function TelehealthButton({ appointmentId, compact }: {
  appointmentId: string
  compact?: boolean
}) {
  const [working, setWorking] = useState(false)

  async function start() {
    setWorking(true)
    try {
      const res = await fetch(`/api/ehr/appointments/${appointmentId}/telehealth`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.url) throw new Error(json.error || 'Could not start telehealth')
      window.open(json.url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Telehealth failed')
    } finally {
      setWorking(false)
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={working}
      className={
        compact
          ? 'inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 font-medium disabled:opacity-50'
          : 'inline-flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md transition disabled:opacity-50'
      }
    >
      <Video className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {working ? 'Starting…' : compact ? 'Telehealth' : 'Start telehealth'}
    </button>
  )
}

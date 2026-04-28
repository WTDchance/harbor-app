// components/today/widgets/WaitingRooms.tsx
//
// W47 T1 — Today widget: patients currently in the waiting room.
// Polls every 15s while the page is open. Hides when nobody is waiting.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type WaitingRow = {
  id: string
  scheduled_for: string
  therapist_id: string | null
  patient_first: string | null
  patient_last: string | null
  minutes_waiting: number
}

export default function WaitingRoomsWidget() {
  const [rows, setRows] = useState<WaitingRow[]>([])
  const [loaded, setLoaded] = useState(false)

  async function load() {
    try {
      const res = await fetch('/api/ehr/admin/waiting-rooms-now')
      if (!res.ok) return
      const j = await res.json()
      setRows(j.in_waiting_room || [])
    } finally { setLoaded(true) }
  }

  useEffect(() => {
    void load()
    const interval = setInterval(load, 15_000)
    return () => clearInterval(interval)
  }, [])

  if (!loaded || rows.length === 0) return null

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2 px-1">
        In the waiting room
      </h2>
      <div className="space-y-2">
        {rows.map((r) => (
          <Link key={r.id} href={`/meet/${r.id}`}
                className="block bg-white border border-amber-200 rounded-xl p-3 hover:bg-amber-50">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium text-sm">
                  {(r.patient_first || '') + ' ' + (r.patient_last || '')}
                </div>
                <div className="text-xs text-gray-500">
                  Waiting {r.minutes_waiting} min · scheduled {new Date(r.scheduled_for).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                Patient is here
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

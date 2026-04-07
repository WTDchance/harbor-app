// components/IntakeProgress.tsx
'use client'

import { useEffect, useState } from 'react'

type PacketItem = {
  id: string
  document_type: string
  document_title: string
  status: 'pending' | 'sent' | 'opened' | 'completed'
  sent_at: string | null
  opened_at: string | null
  completed_at: string | null
  reminder_count: number
  last_reminder_at: string | null
}

type Packet = {
  id: string
  status: string
  total_items: number
  completed_items: number
  last_reminder_at: string | null
  reminder_count: number
  created_at: string
}

export default function IntakeProgress({ patientId }: { patientId: string }) {
  const [packet, setPacket] = useState<Packet | null>(null)
  const [items, setItems] = useState<PacketItem[]>([])
  const [loading, setLoading] = useState(true)
  const [resending, setResending] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/intake/packets/${patientId}`)
      const j = await r.json()
      setPacket(j.packet ?? null)
      setItems(j.items ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (patientId) load() }, [patientId])

  async function createPacket() {
    const r = await fetch('/api/intake/packets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patient_id: patientId }),
    })
    if (r.ok) load()
  }

  async function resendItem(item: PacketItem) {
    setResending(item.id)
    try {
      await fetch('/api/intake/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          packet_item_id: item.id,
          manual_resend: true,
        }),
      })
      await load()
    } finally {
      setResending(null)
    }
  }

  if (loading) return <div className="text-sm text-gray-500">Loading intake progressâ¦</div>

  if (!packet) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-4">
        <p className="text-sm text-gray-600 mb-2">No intake packet sent to this patient yet.</p>
        <button
          onClick={createPacket}
          className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
        >
          Create intake packet
        </button>
      </div>
    )
  }

  const pct = packet.total_items > 0
    ? Math.round((packet.completed_items / packet.total_items) * 100)
    : 0

  const badge =
    packet.status === 'complete' ? 'bg-green-100 text-green-800' :
    packet.status === 'partial'  ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-gray-100 text-gray-700'

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">Intake Packet</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full ${badge}`}>
          {packet.status === 'complete' ? 'Complete' :
           packet.status === 'partial' ? 'In progress' : 'Not started'}
        </span>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-600 mb-1">
          <span>{packet.completed_items} of {packet.total_items} complete</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="divide-y divide-gray-100">
        {items.map(it => (
          <li key={it.id} className="py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                it.status === 'completed' ? 'bg-green-500' :
                it.status === 'opened'    ? 'bg-blue-500' :
                it.status === 'sent'      ? 'bg-yellow-400' :
                                             'bg-gray-300'
              }`} />
              <span className="text-sm">{it.document_title}</span>
            </div>
            <div className="flex items-center gap-3">
              {it.reminder_count > 0 && (
                <span className="text-xs text-gray-500">
                  {it.reminder_count} reminder{it.reminder_count > 1 ? 's' : ''}
                </span>
              )}
              {it.status !== 'completed' && (
                <button
                  onClick={() => resendItem(it)}
                  disabled={resending === it.id}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                >
                  {resending === it.id ? 'Sendingâ¦' : 'Resend'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

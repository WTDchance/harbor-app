// app/dashboard/ehr/audit/page.tsx
// Audit log viewer. Every PHI read/write leaves a row; this is the
// "who did what when" surface a HIPAA auditor would ask for.

'use client'

import { useEffect, useState } from 'react'
import { Shield, Filter } from 'lucide-react'

type Event = {
  id: string
  timestamp: string
  user_email: string | null
  action: string
  resource_id: string | null
  details: Record<string, any> | null
  severity: string | null
}

const ACTION_LABELS: Record<string, string> = {
  'note.list': 'Listed notes',
  'note.view': 'Opened note',
  'note.create': 'Created note / treatment plan / consent',
  'note.update': 'Updated',
  'note.delete': 'Deleted draft',
  'note.sign': 'Signed',
  'note.amend': 'Created amendment',
  'note.draft_from_brief': 'AI-drafted from brief',
  'note.draft_from_call': 'AI-drafted from call',
}

export default function AuditPage() {
  const [events, setEvents] = useState<Event[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/ehr/audit?limit=500')
        if (!res.ok) throw new Error('Failed to load audit events')
        const json = await res.json()
        setEvents(json.events || [])
      } catch {} finally { setLoading(false) }
    }
    load()
  }, [])

  const filtered = (events || []).filter((e) => {
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return (
      e.action.toLowerCase().includes(q) ||
      (e.user_email || '').toLowerCase().includes(q) ||
      (e.resource_id || '').toLowerCase().includes(q) ||
      JSON.stringify(e.details || {}).toLowerCase().includes(q)
    )
  })

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-teal-600" />
            EHR Audit Log
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Every access to a progress note, treatment plan, safety plan, or consent for this practice.
          </p>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Filter className="w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Filter by user, action, resource, or details…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No events.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Resource</th>
                <th className="px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">
                    {new Date(e.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-900">{e.user_email || '—'}</td>
                  <td className="px-4 py-2 text-xs">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                      e.severity === 'warn'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : e.severity === 'error'
                        ? 'bg-red-50 text-red-800 border-red-200'
                        : 'bg-teal-50 text-teal-800 border-teal-200'
                    }`}>
                      {ACTION_LABELS[e.action] || e.action}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-gray-500">
                    {e.resource_id ? e.resource_id.slice(0, 8) + '…' : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-700 max-w-sm truncate" title={JSON.stringify(e.details)}>
                    {e.details ? summarize(e.details) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function summarize(d: Record<string, any>): string {
  const bits: string[] = []
  for (const [k, v] of Object.entries(d)) {
    if (v == null || v === '') continue
    const rendered = Array.isArray(v) ? (v.length ? `[${v.length}]` : '') : String(v).slice(0, 60)
    if (rendered) bits.push(`${k}=${rendered}`)
  }
  return bits.join(' · ')
}

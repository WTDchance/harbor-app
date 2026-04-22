// app/dashboard/ehr/group-sessions/page.tsx — list + create.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, Plus } from 'lucide-react'

type Session = {
  id: string; title: string; group_type: string | null
  scheduled_at: string | null; appointment_id: string | null; created_at: string
}

export default function GroupSessionsPage() {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [groupType, setGroupType] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const r = await fetch('/api/ehr/group-sessions')
    if (r.ok) setSessions((await r.json()).sessions || [])
  }
  useEffect(() => { load() }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      const r = await fetch('/api/ehr/group-sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          group_type: groupType.trim() || null,
          scheduled_at: scheduledAt || null,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed')
      setTitle(''); setGroupType(''); setScheduledAt(''); setCreating(false)
      await load()
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-teal-600" />
            Group sessions
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            DBT skills, process groups, psychoeducation — multiple patients, one clinician, one note shell per participant.
          </p>
        </div>
        <button onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded-lg text-sm">
          <Plus className="w-4 h-4" />
          New group
        </button>
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreating(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Create group session</h3>
            <form onSubmit={create} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} required
                  placeholder="e.g. Monday DBT Skills Group"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
                <input value={groupType} onChange={(e) => setGroupType(e.target.value)}
                  placeholder="DBT Skills, Process, Psychoeducation…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">When</label>
                <input type="datetime-local" value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCreating(false)} className="text-sm text-gray-600 px-3">Cancel</button>
                <button type="submit" disabled={saving}
                  className="bg-teal-600 hover:bg-teal-700 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50">
                  {saving ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {sessions === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : sessions.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-500">
          No group sessions yet.
        </div>
      ) : (
        <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={`/dashboard/ehr/group-sessions/${s.id}`} className="block p-4 hover:bg-gray-50">
                <div className="font-medium text-gray-900">{s.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {s.group_type && <>{s.group_type} · </>}
                  {s.scheduled_at ? new Date(s.scheduled_at).toLocaleString() : `Created ${new Date(s.created_at).toLocaleDateString()}`}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

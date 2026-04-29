// app/dashboard/calendar/blocks/page.tsx
//
// W49 T5 — therapist-side management of personal calendar blocks
// (supervision, admin, lunch, vacation, training, other).

'use client'

import { useEffect, useState } from 'react'

type Block = {
  id: string
  user_id: string
  kind: 'supervision'|'admin'|'lunch'|'vacation'|'training'|'other'
  title: string
  starts_at: string
  ends_at: string
  is_recurring: boolean
  recurrence_rule: string | null
  color: 'blue'|'green'|'yellow'|'red'|'gray'|'purple'
  notes: string | null
}

const KINDS = [
  { value: 'supervision', label: 'Supervision', color: 'purple' as const },
  { value: 'admin',       label: 'Admin',       color: 'gray' as const },
  { value: 'lunch',       label: 'Lunch',       color: 'green' as const },
  { value: 'vacation',    label: 'Vacation',    color: 'blue' as const },
  { value: 'training',    label: 'Training',    color: 'yellow' as const },
  { value: 'other',       label: 'Other',       color: 'gray' as const },
]

const COLOR_CLASSES: Record<Block['color'], string> = {
  blue:   'bg-blue-100 text-blue-800 border-blue-200',
  green:  'bg-green-100 text-green-800 border-green-200',
  yellow: 'bg-amber-100 text-amber-800 border-amber-200',
  red:    'bg-red-100 text-red-800 border-red-200',
  gray:   'bg-gray-100 text-gray-700 border-gray-200',
  purple: 'bg-purple-100 text-purple-800 border-purple-200',
}

function localInput(d: Date): string {
  // YYYY-MM-DDTHH:MM in local time for <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function CalendarBlocksPage() {
  const [blocks, setBlocks] = useState<Block[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create form
  const [kind, setKind] = useState<Block['kind']>('admin')
  const [title, setTitle] = useState('')
  const [startsAt, setStartsAt] = useState(localInput(new Date()))
  const [endsAt, setEndsAt] = useState(() => {
    const d = new Date(); d.setHours(d.getHours() + 1)
    return localInput(d)
  })
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      const from = new Date()
      const to = new Date(Date.now() + 90 * 86_400_000)
      const sp = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })
      const res = await fetch(`/api/ehr/calendar-blocks?${sp.toString()}`)
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const j = await res.json()
      setBlocks(j.blocks || [])
    } catch (e) {
      setError((e as Error).message)
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setCreating(true); setError(null)
    try {
      const meta = KINDS.find((k) => k.value === kind) || KINDS[0]
      const res = await fetch('/api/ehr/calendar-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          starts_at: new Date(startsAt).toISOString(),
          ends_at:   new Date(endsAt).toISOString(),
          color: meta.color,
          notes: notes || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Create failed')
      }
      setTitle(''); setNotes('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally { setCreating(false) }
  }

  async function remove(id: string) {
    if (!confirm('Delete this block?')) return
    await fetch(`/api/ehr/calendar-blocks/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Calendar blocks</h1>
        <p className="text-sm text-gray-600 mt-1">
          Supervision, admin, lunch, vacation, "no-bookings" windows.
          Patient self-scheduling and the AI receptionist won't offer
          slots that overlap a block.
        </p>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded border bg-white p-4 space-y-3">
        <h2 className="font-medium">New block</h2>
        <form onSubmit={create} className="grid grid-cols-2 gap-2">
          <label className="text-sm col-span-2">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200}
                   className="block w-full border rounded px-2 py-1 mt-1" />
          </label>
          <label className="text-sm">
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as Block['kind'])}
                    className="block w-full border rounded px-2 py-1 mt-1">
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            Notes (optional)
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000}
                   className="block w-full border rounded px-2 py-1 mt-1" />
          </label>
          <label className="text-sm">
            Starts
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required
                   className="block w-full border rounded px-2 py-1 mt-1" />
          </label>
          <label className="text-sm">
            Ends
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required
                   className="block w-full border rounded px-2 py-1 mt-1" />
          </label>
          <button type="submit" disabled={creating}
                  className="col-span-2 bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
            {creating ? 'Adding…' : 'Add block'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2 px-1">Upcoming blocks</h2>
        {loading ? <p className="text-sm text-gray-500">Loading…</p>
        : blocks.length === 0 ? <p className="text-sm text-gray-500">No blocks in the next 90 days.</p>
        : (
          <ul className="border rounded divide-y bg-white">
            {blocks.map((b) => {
              const start = new Date(b.starts_at)
              const end = new Date(b.ends_at)
              return (
                <li key={b.id} className="px-3 py-2 text-sm flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${COLOR_CLASSES[b.color]}`}>
                        {b.kind}
                      </span>
                      <span className="font-medium truncate">{b.title}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {start.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      {' → '}
                      {end.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      {b.is_recurring && ' · recurring'}
                    </div>
                    {b.notes && <div className="text-xs text-gray-600 mt-0.5">{b.notes}</div>}
                  </div>
                  <button onClick={() => remove(b.id)}
                          className="text-xs text-red-600 hover:underline">Remove</button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

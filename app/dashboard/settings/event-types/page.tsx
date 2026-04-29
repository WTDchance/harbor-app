// app/dashboard/settings/event-types/page.tsx
//
// W49 D4 — practice event-type manager. List, create, edit duration/CPT,
// archive. Drag to reorder.

'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

interface EventType {
  id: string; name: string; slug: string; color: string
  default_duration_minutes: number
  default_cpt_codes: string[]
  allows_telehealth: boolean; allows_in_person: boolean
  status: 'active' | 'archived'
  is_default: boolean
  sort_order: number
}

const COLORS = ['#6366f1', '#0ea5e9', '#16a34a', '#db2777', '#a855f7', '#f59e0b', '#0d9488', '#dc2626', '#6b7280']

export default function EventTypesPage() {
  const [items, setItems] = useState<EventType[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<EventType>>({ name: '', default_duration_minutes: 50, default_cpt_codes: [] })
  const [showArchived, setShowArchived] = useState(false)
  const dragId = useRef<string | null>(null)

  async function load() {
    setLoading(true)
    const r = await fetch('/api/ehr/practice/event-types?status=' + (showArchived ? 'all' : 'active'))
    const j = await r.json(); if (r.ok) setItems(j.event_types ?? [])
    setLoading(false)
  }
  useEffect(() => { void load() }, [showArchived])

  async function add() {
    if (!draft.name) return
    const r = await fetch('/api/ehr/practice/event-types', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: draft.name,
        default_duration_minutes: draft.default_duration_minutes,
        default_cpt_codes: draft.default_cpt_codes ?? [],
        color: draft.color ?? '#6b7280',
      }),
    })
    if (r.ok) { setDraft({ name: '', default_duration_minutes: 50, default_cpt_codes: [] }); void load() }
  }

  async function save(id: string, patch: Partial<EventType>) {
    const r = await fetch(`/api/ehr/practice/event-types/${id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...patch,
        default_cpt_codes: patch.default_cpt_codes,
      }),
    })
    if (r.ok) { setEditing(null); void load() }
  }

  async function archive(id: string) {
    if (!confirm('Archive this event type? Existing appointments keep it.')) return
    await fetch(`/api/ehr/practice/event-types/${id}`, { method: 'DELETE' })
    void load()
  }

  function onDragOver(e: React.DragEvent, fid: string) {
    e.preventDefault()
    const src = dragId.current; if (!src || src === fid) return
    setItems(s => {
      const from = s.findIndex(x => x.id === src), to = s.findIndex(x => x.id === fid)
      if (from < 0 || to < 0) return s
      const next = s.slice(); const [m] = next.splice(from, 1); next.splice(to, 0, m); return next
    })
  }
  async function persistOrder() {
    await Promise.all(items.map((it, i) => fetch(`/api/ehr/practice/event-types/${it.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sort_order: i * 10 }),
    })))
  }

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading…</div>

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-gray-700">← Back to settings</Link>
      <h1 className="text-2xl font-semibold text-gray-900 mt-2">Calendar event types</h1>
      <p className="text-sm text-gray-500 mt-1">Define the appointment kinds patients and therapists can book — duration, CPT codes, modality.</p>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-5 grid grid-cols-2 sm:grid-cols-6 gap-2">
        <input className="border rounded px-2 py-1 text-sm sm:col-span-2" placeholder="Name" value={draft.name ?? ''} onChange={e => setDraft({ ...draft, name: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm" type="number" min="5" max="480" placeholder="Min" value={draft.default_duration_minutes ?? ''} onChange={e => setDraft({ ...draft, default_duration_minutes: Number(e.target.value) })} />
        <input className="border rounded px-2 py-1 text-sm" placeholder="CPT (90834)" onChange={e => setDraft({ ...draft, default_cpt_codes: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
        <select className="border rounded px-2 py-1 text-sm" value={draft.color ?? '#6b7280'} onChange={e => setDraft({ ...draft, color: e.target.value })}>
          {COLORS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={add} className="bg-blue-600 hover:bg-blue-700 text-white text-sm rounded px-3 py-1.5">Add</button>
      </div>

      <div className="flex justify-between items-center mt-4 mb-2">
        <label className="text-xs text-gray-600 inline-flex items-center gap-1">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived
        </label>
        <button onClick={persistOrder} className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50">Save order</button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl divide-y">
        {items.length === 0 && <div className="p-6 text-center text-sm text-gray-500">No event types.</div>}
        {items.map(it => (
          <div
            key={it.id}
            draggable
            onDragStart={() => { dragId.current = it.id }}
            onDragOver={e => onDragOver(e, it.id)}
            onDragEnd={() => { dragId.current = null }}
            className={`px-4 py-3 ${it.status === 'archived' ? 'opacity-60' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs text-gray-300">⋮⋮</span>
                <span className="w-3 h-3 rounded-full inline-block flex-shrink-0" style={{ background: it.color }} />
                <div className="min-w-0">
                  <div className="font-medium text-gray-900">{it.name}{it.is_default && <span className="ml-2 text-[10px] uppercase text-blue-600">default</span>}</div>
                  <div className="text-xs text-gray-500">
                    {it.default_duration_minutes}m · {it.default_cpt_codes.length ? it.default_cpt_codes.join(', ') : 'no CPT'} ·
                    {' '}{it.allows_telehealth ? 'video' : ''}{it.allows_telehealth && it.allows_in_person ? ' / ' : ''}{it.allows_in_person ? 'in-person' : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {!it.is_default && <button onClick={() => save(it.id, { is_default: true })} className="text-blue-600 hover:text-blue-800">Set default</button>}
                <button onClick={() => setEditing(editing === it.id ? null : it.id)} className="text-gray-600 hover:text-gray-900">{editing === it.id ? 'Close' : 'Edit'}</button>
                {it.status === 'active' && <button onClick={() => archive(it.id)} className="text-red-600 hover:text-red-700">Archive</button>}
              </div>
            </div>
            {editing === it.id && <Editor row={it} onSave={(p) => save(it.id, p)} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function Editor({ row, onSave }: { row: EventType; onSave: (p: Partial<EventType>) => void }) {
  const [name, setName] = useState(row.name)
  const [dur, setDur] = useState(row.default_duration_minutes)
  const [cpt, setCpt] = useState(row.default_cpt_codes.join(', '))
  const [color, setColor] = useState(row.color)
  const [tele, setTele] = useState(row.allows_telehealth)
  const [inp, setInp] = useState(row.allows_in_person)
  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-6 gap-2 text-sm">
      <input className="border rounded px-2 py-1 sm:col-span-2" value={name} onChange={e => setName(e.target.value)} />
      <input className="border rounded px-2 py-1" type="number" min="5" max="480" value={dur} onChange={e => setDur(Number(e.target.value))} />
      <input className="border rounded px-2 py-1" value={cpt} onChange={e => setCpt(e.target.value)} />
      <select className="border rounded px-2 py-1" value={color} onChange={e => setColor(e.target.value)}>
        {COLORS.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <button onClick={() => onSave({
        name, default_duration_minutes: dur,
        default_cpt_codes: cpt.split(',').map(s => s.trim()).filter(Boolean),
        color, allows_telehealth: tele, allows_in_person: inp,
      })} className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-1">Save</button>
      <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={tele} onChange={e => setTele(e.target.checked)} /> Telehealth</label>
      <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={inp} onChange={e => setInp(e.target.checked)} /> In-person</label>
    </div>
  )
}

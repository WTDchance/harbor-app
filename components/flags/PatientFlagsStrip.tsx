// components/flags/PatientFlagsStrip.tsx
//
// W47 T4 — sticky-note context chips on the patient header. Up to
// 5 active flags. Inline add + edit + archive without leaving the
// patient profile.

'use client'

import { useEffect, useState } from 'react'

type Flag = {
  id: string
  content: string
  color: 'blue' | 'green' | 'yellow' | 'red'
  archived_at: string | null
}

const COLOR_CLASSES: Record<Flag['color'], string> = {
  blue:   'bg-blue-100 text-blue-800 border-blue-200',
  green:  'bg-green-100 text-green-800 border-green-200',
  yellow: 'bg-amber-100 text-amber-800 border-amber-200',
  red:    'bg-red-100 text-red-800 border-red-200',
}

const COLORS: Flag['color'][] = ['blue', 'green', 'yellow', 'red']
const MAX_ACTIVE = 5

export default function PatientFlagsStrip({ patientId }: { patientId: string }) {
  const [flags, setFlags] = useState<Flag[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [content, setContent] = useState('')
  const [color, setColor] = useState<Flag['color']>('blue')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/flags`)
      if (!res.ok) return
      const j = await res.json()
      setFlags(j.flags || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [patientId])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    setError(null)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/flags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, color }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error === 'flag_limit_reached'
          ? `Up to ${MAX_ACTIVE} active flags. Archive one first.`
          : j.error || 'Failed')
      }
      setContent(''); setColor('blue'); setAdding(false)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function archive(id: string) {
    await fetch(`/api/ehr/patients/${patientId}/flags/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    })
    await load()
  }

  async function updateFlag(id: string, patch: Partial<Flag>) {
    await fetch(`/api/ehr/patients/${patientId}/flags/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    setEditingId(null)
    await load()
  }

  if (loading) return null
  const active = flags.filter((f) => !f.archived_at)
  const atLimit = active.length >= MAX_ACTIVE

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {active.map((f) => (
          <FlagChip key={f.id}
                    flag={f}
                    editing={editingId === f.id}
                    onStartEdit={() => setEditingId(f.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onUpdate={(patch) => updateFlag(f.id, patch)}
                    onArchive={() => archive(f.id)} />
        ))}
        {!adding && !atLimit && (
          <button onClick={() => setAdding(true)}
                  className="text-xs px-2 py-0.5 rounded-full border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50">
            + Add flag
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={add} className="rounded border bg-white p-2 space-y-2 max-w-md">
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={200}
            placeholder="e.g. Going through divorce"
            className="block w-full border rounded px-2 py-1 text-sm"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)}
                        className={`w-5 h-5 rounded-full border-2 ${color === c ? 'ring-2 ring-offset-1 ring-[#1f375d]' : ''} ${COLOR_CLASSES[c]}`}
                        title={c} />
              ))}
            </div>
            <button type="submit" disabled={!content.trim()}
                    className="bg-[#1f375d] text-white px-2 py-1 rounded text-xs disabled:opacity-50">Add</button>
            <button type="button" onClick={() => { setAdding(false); setContent('') }}
                    className="text-xs text-gray-500 hover:underline">Cancel</button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>
      )}
    </div>
  )
}

function FlagChip({
  flag, editing, onStartEdit, onCancelEdit, onUpdate, onArchive,
}: {
  flag: Flag
  editing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onUpdate: (patch: Partial<Flag>) => void
  onArchive: () => void
}) {
  const [content, setContent] = useState(flag.content)
  const [color, setColor] = useState<Flag['color']>(flag.color)

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-white">
        <input value={content} onChange={(e) => setContent(e.target.value)}
               maxLength={200}
               className="text-xs border-b focus:outline-none px-1 w-40" />
        <div className="flex gap-0.5">
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)}
                    className={`w-3 h-3 rounded-full ${COLOR_CLASSES[c]} ${color === c ? 'ring-1 ring-[#1f375d]' : ''}`} />
          ))}
        </div>
        <button onClick={() => onUpdate({ content, color })}
                className="text-xs text-[#1f375d] hover:underline">Save</button>
        <button onClick={onCancelEdit}
                className="text-xs text-gray-500 hover:underline">Cancel</button>
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs ${COLOR_CLASSES[flag.color]}`}>
      <span>{flag.content}</span>
      <button onClick={onStartEdit} className="opacity-60 hover:opacity-100" title="Edit">✎</button>
      <button onClick={onArchive} className="opacity-60 hover:opacity-100" title="Archive">×</button>
    </span>
  )
}

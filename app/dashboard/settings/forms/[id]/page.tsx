// app/dashboard/settings/forms/[id]/page.tsx
//
// W49 D1 — drag-drop builder for a single custom form.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

const FIELD_TYPES = [
  { id: 'short_text',  label: 'Short text' },
  { id: 'long_text',   label: 'Long text' },
  { id: 'select',      label: 'Single choice' },
  { id: 'multiselect', label: 'Multi-select' },
  { id: 'rating',      label: 'Rating' },
  { id: 'date',        label: 'Date' },
  { id: 'signature',   label: 'Signature' },
  { id: 'phone',       label: 'Phone' },
  { id: 'email',       label: 'Email' },
  { id: 'number',      label: 'Number' },
] as const

interface Field {
  id: string
  type: typeof FIELD_TYPES[number]['id']
  label: string
  required: boolean
  options?: string[]
  validation?: { min?: number; max?: number; regex?: string }
  helpText?: string
}

function genId(): string {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) return (crypto as any).randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

export default function FormBuilderPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const router = useRouter()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<'draft' | 'published' | 'archived'>('draft')
  const [schema, setSchema] = useState<Field[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/ehr/practice/custom-forms/${id}`)
      const j = await res.json()
      if (!res.ok) { alert(j.error || 'Failed to load'); return }
      if (cancelled) return
      const f = j.form
      setName(f.name); setDescription(f.description ?? ''); setStatus(f.status)
      setSchema(Array.isArray(f.schema) ? f.schema : [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [id])

  const save = useCallback(async (override?: { status?: 'draft' | 'published' | 'archived' }) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/ehr/practice/custom-forms/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description, schema, status: override?.status ?? status }),
      })
      const j = await res.json()
      if (!res.ok) { alert(j.message || j.error || 'Save failed'); return }
      if (override?.status) setStatus(override.status)
      setSavedAt(new Date())
    } finally { setSaving(false) }
  }, [id, name, description, schema, status])

  function addField(type: Field['type']) {
    const base: Field = { id: genId(), type, label: 'Untitled question', required: false }
    if (type === 'select' || type === 'multiselect') base.options = ['Option 1', 'Option 2']
    if (type === 'rating') base.validation = { min: 1, max: 5 }
    setSchema((s) => [...s, base])
    setEditing(base.id)
  }

  function updateField(fid: string, patch: Partial<Field>) {
    setSchema((s) => s.map(f => f.id === fid ? { ...f, ...patch } : f))
  }
  function deleteField(fid: string) {
    setSchema((s) => s.filter(f => f.id !== fid))
    if (editing === fid) setEditing(null)
  }

  function onDragStart(fid: string) { dragId.current = fid }
  function onDragOver(e: React.DragEvent, fid: string) {
    e.preventDefault()
    const src = dragId.current
    if (!src || src === fid) return
    setSchema((s) => {
      const from = s.findIndex(x => x.id === src)
      const to = s.findIndex(x => x.id === fid)
      if (from < 0 || to < 0) return s
      const next = s.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }
  function onDragEnd() { dragId.current = null }

  async function deleteForm() {
    if (!confirm('Delete this form? Patients with pending assignments will see an "expired" message.')) return
    const res = await fetch(`/api/ehr/practice/custom-forms/${id}`, { method: 'DELETE' })
    if (res.ok) router.push('/dashboard/settings/forms')
    else alert('Delete failed')
  }

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading…</div>

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <Link href="/dashboard/settings/forms" className="text-sm text-gray-500 hover:text-gray-700">← All forms</Link>
        <div className="flex items-center gap-3">
          {savedAt && <span className="text-xs text-gray-400">Saved {savedAt.toLocaleTimeString()}</span>}
          <button onClick={() => save()} disabled={saving} className="text-sm border border-gray-300 px-3 py-1.5 rounded-md hover:bg-gray-50">
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          {status !== 'published' ? (
            <button onClick={() => save({ status: 'published' })} disabled={saving} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md">
              Publish
            </button>
          ) : (
            <button onClick={() => save({ status: 'draft' })} disabled={saving} className="text-sm border border-gray-300 px-3 py-1.5 rounded-md">
              Unpublish
            </button>
          )}
          <button onClick={deleteForm} className="text-sm text-red-600 hover:text-red-700">Delete</button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)}
          className="w-full text-2xl font-semibold text-gray-900 outline-none"
          placeholder="Form name"
        />
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)}
          className="w-full mt-2 text-sm text-gray-600 outline-none resize-none"
          placeholder="Optional description shown to patients at the top of the form."
          rows={2}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          {schema.length === 0 && (
            <div className="text-center text-sm text-gray-500 py-12">
              No fields yet. Add one from the right.
            </div>
          )}
          {schema.map((f, i) => (
            <div
              key={f.id}
              draggable
              onDragStart={() => onDragStart(f.id)}
              onDragOver={(e) => onDragOver(e, f.id)}
              onDragEnd={onDragEnd}
              className={`border rounded-md p-3 cursor-move hover:border-blue-400 ${editing === f.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
              onClick={() => setEditing(f.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-400">⋮⋮</span>
                  <span className="text-xs uppercase tracking-wide text-gray-500">{f.type.replace('_', ' ')}</span>
                  <span className="font-medium text-gray-900 truncate">{f.label || `Question ${i + 1}`}</span>
                  {f.required && <span className="text-[10px] uppercase text-red-600">required</span>}
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteField(f.id) }} className="text-xs text-gray-400 hover:text-red-600">Remove</button>
              </div>
              {editing === f.id && (
                <FieldEditor field={f} onChange={(patch) => updateField(f.id, patch)} />
              )}
            </div>
          ))}
        </div>

        <aside className="bg-white border border-gray-200 rounded-xl p-3 h-fit">
          <h2 className="text-xs uppercase tracking-wide font-semibold text-gray-500 px-2 pb-2">Add field</h2>
          {FIELD_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => addField(t.id)}
              className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100 rounded"
            >
              + {t.label}
            </button>
          ))}
        </aside>
      </div>
    </div>
  )
}

function FieldEditor({ field, onChange }: { field: Field; onChange: (p: Partial<Field>) => void }) {
  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <label className="block">
        <span className="text-xs text-gray-500">Question label</span>
        <input
          type="text" value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={field.required} onChange={(e) => onChange({ required: e.target.checked })} />
        Required
      </label>

      {(field.type === 'select' || field.type === 'multiselect') && (
        <label className="block">
          <span className="text-xs text-gray-500">Options (one per line)</span>
          <textarea
            value={(field.options ?? []).join('\n')}
            onChange={(e) => onChange({ options: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
            rows={4}
            className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono"
          />
        </label>
      )}

      {field.type === 'rating' && (
        <div className="flex gap-2">
          <label className="block flex-1">
            <span className="text-xs text-gray-500">Min</span>
            <input type="number" value={field.validation?.min ?? 1} onChange={(e) => onChange({ validation: { ...field.validation, min: Number(e.target.value) } })} className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm" />
          </label>
          <label className="block flex-1">
            <span className="text-xs text-gray-500">Max</span>
            <input type="number" value={field.validation?.max ?? 5} onChange={(e) => onChange({ validation: { ...field.validation, max: Number(e.target.value) } })} className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm" />
          </label>
        </div>
      )}

      <label className="block">
        <span className="text-xs text-gray-500">Help text (shown below the question)</span>
        <input
          type="text" value={field.helpText ?? ''}
          onChange={(e) => onChange({ helpText: e.target.value })}
          className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm"
        />
      </label>
    </div>
  )
}

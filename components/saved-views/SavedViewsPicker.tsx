// components/saved-views/SavedViewsPicker.tsx
//
// W47 T5 — saved views dropdown for the patient list. Caller provides
// the current filter+sort state and a setter; this component handles
// list / save-as / share-toggle / delete.

'use client'

import { useEffect, useState } from 'react'

type View = {
  id: string
  name: string
  filters: Record<string, unknown>
  sort: Record<string, unknown>
  is_shared_with_practice: boolean
  is_mine: boolean
}

interface Props {
  currentFilters: Record<string, unknown>
  currentSort: Record<string, unknown>
  onApply: (filters: Record<string, unknown>, sort: Record<string, unknown>) => void
}

export default function SavedViewsPicker({ currentFilters, currentSort, onApply }: Props) {
  const [views, setViews] = useState<View[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveShared, setSaveShared] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/ehr/saved-views')
      if (!res.ok) return
      const j = await res.json()
      setViews(j.views || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function apply(viewId: string) {
    setActiveId(viewId)
    const v = views.find((x) => x.id === viewId)
    if (!v) return
    onApply(v.filters, v.sort)
    fetch(`/api/ehr/saved-views/${viewId}`).catch(() => {}) // audit ping
  }

  async function saveCurrent(e: React.FormEvent) {
    e.preventDefault()
    if (!saveName.trim()) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/ehr/saved-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveName.trim(),
          filters: currentFilters,
          sort: currentSort,
          is_shared_with_practice: saveShared,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Save failed')
      }
      setSaveOpen(false); setSaveName(''); setSaveShared(false)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally { setSaving(false) }
  }

  async function remove(viewId: string) {
    if (!confirm('Delete this saved view?')) return
    await fetch(`/api/ehr/saved-views/${viewId}`, { method: 'DELETE' })
    if (activeId === viewId) setActiveId(null)
    await load()
  }

  if (loading) return null

  const mine = views.filter((v) => v.is_mine)
  const shared = views.filter((v) => !v.is_mine && v.is_shared_with_practice)

  return (
    <div className="flex items-center gap-2">
      <select
        value={activeId || ''}
        onChange={(e) => apply(e.target.value)}
        className="border rounded px-2 py-1 text-sm"
      >
        <option value="">Saved views…</option>
        {mine.length > 0 && (
          <optgroup label="My views">
            {mine.map((v) => <option key={v.id} value={v.id}>{v.name}{v.is_shared_with_practice ? ' (shared)' : ''}</option>)}
          </optgroup>
        )}
        {shared.length > 0 && (
          <optgroup label="Practice views">
            {shared.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </optgroup>
        )}
      </select>
      <button onClick={() => setSaveOpen(!saveOpen)}
              className="text-sm text-[#1f375d] hover:underline">
        Save current as…
      </button>
      {activeId && mine.find((v) => v.id === activeId) && (
        <button onClick={() => remove(activeId)}
                className="text-xs text-red-600 hover:underline">Delete view</button>
      )}

      {saveOpen && (
        <form onSubmit={saveCurrent} className="absolute mt-8 z-10 rounded border bg-white p-3 shadow space-y-2">
          <input value={saveName} onChange={(e) => setSaveName(e.target.value)}
                 placeholder="View name"
                 className="block border rounded px-2 py-1 text-sm" autoFocus required />
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input type="checkbox" checked={saveShared}
                   onChange={(e) => setSaveShared(e.target.checked)} />
            Share with my practice
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={saving || !saveName.trim()}
                    className="bg-[#1f375d] text-white px-2 py-1 rounded text-xs disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setSaveOpen(false)}
                    className="text-xs text-gray-500 hover:underline">Cancel</button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>
      )}
    </div>
  )
}

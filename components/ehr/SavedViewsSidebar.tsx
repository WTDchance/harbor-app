// components/ehr/SavedViewsSidebar.tsx
//
// W49 D5 — Saved Views sidebar for /dashboard/patients with a chip-based
// filter builder + "Save current view as…" action.

'use client'

import { useEffect, useState } from 'react'
import {
  PATIENT_FLAG_META, PATIENT_FLAG_TYPES, type PatientFlagType,
  type FilterNode, type FilterGroup, type FilterLeaf,
} from '@/lib/ehr/patient-flags'

export interface SavedView {
  id: string; user_id: string; name: string
  scope: 'personal' | 'practice'
  filter: FilterNode | Record<string, never>
  sort: { field?: string; direction?: 'asc' | 'desc' }
  columns: string[]
}

export default function SavedViewsSidebar({
  selectedId, onSelect, currentFilter, currentSort,
}: {
  selectedId: string | null
  onSelect: (view: SavedView | null) => void
  currentFilter: FilterNode
  currentSort: { field?: string; direction?: 'asc' | 'desc' }
}) {
  const [views, setViews] = useState<SavedView[]>([])
  const [loading, setLoading] = useState(true)
  const [savingName, setSavingName] = useState<string | null>(null)
  const [newScope, setNewScope] = useState<'personal' | 'practice'>('personal')

  async function load() {
    setLoading(true)
    const r = await fetch('/api/ehr/saved-views')
    const j = await r.json(); if (r.ok) setViews(j.saved_views ?? [])
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  async function saveAs() {
    if (!savingName) return
    const r = await fetch('/api/ehr/saved-views', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: savingName, scope: newScope, filter: currentFilter, sort: currentSort, columns: [] }),
    })
    if (r.ok) { setSavingName(null); void load() }
  }
  async function del(id: string) {
    if (!confirm('Delete this view?')) return
    await fetch(`/api/ehr/saved-views/${id}`, { method: 'DELETE' })
    if (selectedId === id) onSelect(null)
    void load()
  }

  return (
    <aside className="w-60 flex-shrink-0 border-r border-gray-200 bg-gray-50 px-3 py-4">
      <h2 className="text-xs uppercase tracking-wide font-semibold text-gray-500 mb-2">Saved views</h2>

      <button onClick={() => onSelect(null)}
        className={`w-full text-left text-sm rounded px-2 py-1.5 mb-1 ${selectedId === null ? 'bg-blue-100 text-blue-900' : 'hover:bg-gray-100'}`}>
        All patients
      </button>

      {loading && <div className="text-xs text-gray-400">Loading…</div>}

      {views.filter(v => v.scope === 'personal').length > 0 && <div className="text-[10px] uppercase text-gray-400 mt-3 mb-1">Mine</div>}
      {views.filter(v => v.scope === 'personal').map(v => (
        <ViewRow key={v.id} v={v} active={selectedId === v.id} onSelect={() => onSelect(v)} onDelete={() => del(v.id)} />
      ))}

      {views.filter(v => v.scope === 'practice').length > 0 && <div className="text-[10px] uppercase text-gray-400 mt-3 mb-1">Shared with practice</div>}
      {views.filter(v => v.scope === 'practice').map(v => (
        <ViewRow key={v.id} v={v} active={selectedId === v.id} onSelect={() => onSelect(v)} onDelete={() => del(v.id)} />
      ))}

      <div className="mt-4 border-t border-gray-200 pt-3">
        {savingName === null ? (
          <button onClick={() => setSavingName('Untitled view')}
            className="text-xs text-blue-600 hover:text-blue-700">+ Save current view</button>
        ) : (
          <div className="space-y-2">
            <input className="w-full border border-gray-300 rounded px-2 py-1 text-xs" value={savingName} autoFocus onChange={e => setSavingName(e.target.value)} />
            <select className="w-full border border-gray-300 rounded px-2 py-1 text-xs" value={newScope} onChange={e => setNewScope(e.target.value as 'personal' | 'practice')}>
              <option value="personal">Personal</option>
              <option value="practice">Share with practice</option>
            </select>
            <div className="flex gap-2">
              <button onClick={saveAs} className="bg-blue-600 hover:bg-blue-700 text-white text-xs rounded px-2 py-1 flex-1">Save</button>
              <button onClick={() => setSavingName(null)} className="text-xs text-gray-500">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

function ViewRow({ v, active, onSelect, onDelete }: { v: SavedView; active: boolean; onSelect: () => void; onDelete: () => void }) {
  return (
    <div className={`group flex items-center justify-between rounded px-2 py-1.5 ${active ? 'bg-blue-100' : 'hover:bg-gray-100'}`}>
      <button onClick={onSelect} className="flex-1 text-left text-sm truncate">{v.name}</button>
      <button onClick={onDelete} className="text-[10px] text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100">Del</button>
    </div>
  )
}

// ─── Chip filter builder ───────────────────────────────────────────────

export function FilterChipBar({ value, onChange }: { value: FilterNode; onChange: (n: FilterNode) => void }) {
  const flagPredicate = findFlagPredicate(value)
  const status = findStatusPredicate(value)

  function setFlags(types: PatientFlagType[], op: 'has_any' | 'has_all' | 'has_none') {
    const others = stripPredicate(value, p => 'field' in p && p.field === 'flags')
    if (types.length === 0) return onChange(others)
    const leaf: FilterLeaf = { field: 'flags', comparator: op, value: types }
    onChange(addPredicate(others, leaf))
  }

  function setStatus(s: string | null) {
    const others = stripPredicate(value, p => 'field' in p && p.field === 'status')
    if (!s) return onChange(others)
    onChange(addPredicate(others, { field: 'status', comparator: 'eq', value: s }))
  }

  const flagTypes: PatientFlagType[] = (flagPredicate?.value as PatientFlagType[] | undefined) ?? []
  const flagOp = (flagPredicate?.comparator as 'has_any' | 'has_all' | 'has_none' | undefined) ?? 'has_any'

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 py-2">
      <span className="text-xs text-gray-500">Filters:</span>

      <select className="border border-gray-300 rounded px-2 py-0.5 text-xs"
        value={status?.value as string ?? ''} onChange={(e) => setStatus(e.target.value || null)}>
        <option value="">Any status</option>
        <option value="active">Active</option>
        <option value="discharged">Discharged</option>
        <option value="inactive">Inactive</option>
      </select>

      <div className="inline-flex items-center gap-1 border border-gray-300 rounded px-2 py-0.5 text-xs">
        <select value={flagOp} onChange={(e) => setFlags(flagTypes, e.target.value as any)} className="bg-transparent">
          <option value="has_any">Any of</option>
          <option value="has_all">All of</option>
          <option value="has_none">None of</option>
        </select>
        <span className="text-gray-400">flags:</span>
      </div>

      {PATIENT_FLAG_TYPES.map(t => {
        const active = flagTypes.includes(t)
        return (
          <button key={t}
            onClick={() => setFlags(active ? flagTypes.filter(x => x !== t) : [...flagTypes, t], flagOp)}
            className={`uppercase tracking-wide text-[10px] px-1.5 py-0.5 rounded border ${active ? PATIENT_FLAG_META[t].className : 'border-gray-200 text-gray-500 bg-white hover:bg-gray-50'}`}>
            {PATIENT_FLAG_META[t].label}
          </button>
        )
      })}

      <button onClick={() => onChange(emptyFilter())} className="text-[10px] text-gray-500 hover:text-gray-800 ml-2">Clear all</button>
    </div>
  )
}

export function emptyFilter(): FilterNode {
  return { op: 'and', predicates: [] }
}

function isLeaf(n: FilterNode): n is FilterLeaf {
  return n != null && typeof n === 'object' && 'field' in n
}

function findFlagPredicate(n: FilterNode): FilterLeaf | null {
  if (!n || isLeaf(n)) return n && isLeaf(n) && n.field === 'flags' ? n : null
  for (const p of n.predicates) {
    if (isLeaf(p) && p.field === 'flags') return p
    const sub = findFlagPredicate(p); if (sub) return sub
  }
  return null
}
function findStatusPredicate(n: FilterNode): FilterLeaf | null {
  if (!n || isLeaf(n)) return n && isLeaf(n) && n.field === 'status' ? n : null
  for (const p of n.predicates) {
    if (isLeaf(p) && p.field === 'status') return p
    const sub = findStatusPredicate(p); if (sub) return sub
  }
  return null
}
function stripPredicate(n: FilterNode, pred: (p: FilterNode) => boolean): FilterNode {
  if (!n || isLeaf(n)) return n
  return { op: n.op, predicates: n.predicates.filter(p => !pred(p)).map(p => stripPredicate(p, pred)) }
}
function addPredicate(n: FilterNode, leaf: FilterLeaf): FilterNode {
  if (!n || isLeaf(n)) return { op: 'and', predicates: [leaf] }
  return { op: n.op || 'and', predicates: [...n.predicates, leaf] }
}

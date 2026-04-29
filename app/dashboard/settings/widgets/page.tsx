// app/dashboard/settings/widgets/page.tsx
//
// W49 D6 — drag-and-drop dashboard widget configurator.

'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { WIDGET_REGISTRY, type WidgetId } from '@/lib/ui/widget-registry'

export default function WidgetSettingsPage() {
  const [enabled, setEnabled] = useState<WidgetId[]>([])
  const [available, setAvailable] = useState<WidgetId[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const dragId = useRef<WidgetId | null>(null)

  async function load() {
    setLoading(true)
    const r = await fetch('/api/ehr/me/layout')
    const j = await r.json()
    if (r.ok) {
      const validIds = Object.keys(WIDGET_REGISTRY) as WidgetId[]
      const got = (j.widgets ?? []).filter((id: string) => (validIds as string[]).includes(id)) as WidgetId[]
      setEnabled(got)
      setAvailable(validIds.filter(id => !got.includes(id)))
    }
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  async function save(next: WidgetId[]) {
    setSaving(true)
    const r = await fetch('/api/ehr/me/layout', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ widgets: next }),
    })
    if (r.ok) setSavedAt(new Date())
    setSaving(false)
  }

  async function reset() {
    if (!confirm('Reset to defaults?')) return
    const r = await fetch('/api/ehr/me/layout', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ widgets: null }),
    })
    if (r.ok) { setSavedAt(new Date()); void load() }
  }

  function add(id: WidgetId) {
    const next = [...enabled, id]
    setEnabled(next); setAvailable(a => a.filter(x => x !== id))
    void save(next)
  }
  function remove(id: WidgetId) {
    const next = enabled.filter(x => x !== id)
    setEnabled(next); setAvailable(a => [...a, id])
    void save(next)
  }
  function onDragOver(e: React.DragEvent, id: WidgetId) {
    e.preventDefault()
    const src = dragId.current
    if (!src || src === id) return
    setEnabled(s => {
      const from = s.indexOf(src), to = s.indexOf(id)
      if (from < 0 || to < 0) return s
      const next = s.slice(); const [m] = next.splice(from, 1); next.splice(to, 0, m)
      return next
    })
  }
  function onDragEnd() { void save(enabled); dragId.current = null }

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading…</div>

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-gray-700">← Back to settings</Link>
        <div className="flex items-center gap-3">
          {savedAt && <span className="text-xs text-gray-400">{saving ? 'Saving…' : `Saved ${savedAt.toLocaleTimeString()}`}</span>}
          <button onClick={reset} className="text-xs text-gray-600 hover:text-gray-900">Reset to defaults</button>
        </div>
      </div>

      <h1 className="text-2xl font-semibold text-gray-900">Dashboard widgets</h1>
      <p className="text-sm text-gray-500 mt-1">
        Drag to reorder. Click + to add a widget; click × to remove.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 mt-6">
        <div className="bg-white border border-gray-200 rounded-xl p-3 min-h-[180px] space-y-2">
          {enabled.length === 0 && (
            <div className="text-sm text-gray-400 text-center py-12">
              No widgets enabled. Add one from the right.
            </div>
          )}
          {enabled.map(id => {
            const meta = WIDGET_REGISTRY[id]
            return (
              <div key={id}
                draggable
                onDragStart={() => { dragId.current = id }}
                onDragOver={e => onDragOver(e, id)}
                onDragEnd={onDragEnd}
                className="flex items-start gap-3 border border-gray-200 rounded-md p-3 cursor-move bg-white hover:border-blue-400">
                <span className="text-gray-300 mt-0.5">⋮⋮</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{meta.name}</span>
                    {meta.default_size && <span className="text-[10px] uppercase tracking-wide text-gray-400">{meta.default_size}</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
                  <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-gray-500">
                    {meta.refresh_interval_seconds !== undefined && (
                      <span>Refresh every {meta.refresh_interval_seconds}s</span>
                    )}
                    {meta.drilldown_path && (
                      <span>Drill-down: <span className="font-mono">{meta.drilldown_path}</span></span>
                    )}
                  </div>
                </div>
                <button onClick={() => remove(id)} className="text-gray-400 hover:text-red-600 text-sm">×</button>
              </div>
            )
          })}
        </div>

        <aside className="bg-white border border-gray-200 rounded-xl p-3 h-fit">
          <h2 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">Available</h2>
          {available.length === 0 && <div className="text-sm text-gray-400">All widgets enabled.</div>}
          {available.map(id => {
            const meta = WIDGET_REGISTRY[id]
            return (
              <button key={id} onClick={() => add(id)}
                className="w-full text-left p-2 rounded hover:bg-gray-100">
                <div className="text-sm font-medium text-gray-900">{meta.name}</div>
                <div className="text-xs text-gray-500">{meta.description}</div>
              </button>
            )
          })}
        </aside>
      </div>
    </div>
  )
}

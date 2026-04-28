// app/dashboard/settings/layout/page.tsx
//
// W46 T6 — per-therapist customization of Today widgets + sidebar
// modules. Keep / reorder / hide. "Reset to practice default" clears
// the per-user preference.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { WIDGET_REGISTRY, type WidgetId } from '@/lib/ui/widget-registry'
import { SIDEBAR_REGISTRY, type SidebarModuleId } from '@/lib/ui/sidebar-registry'

type LayoutResp = {
  widgets: WidgetId[]
  sidebar: SidebarModuleId[]
  user_pref_widgets: WidgetId[] | null
  user_pref_sidebar: SidebarModuleId[] | null
  practice_default_widgets: WidgetId[] | null
  practice_default_sidebar: SidebarModuleId[] | null
}

export default function LayoutSettingsPage() {
  const [data, setData] = useState<LayoutResp | null>(null)
  const [widgets, setWidgets] = useState<WidgetId[]>([])
  const [sidebar, setSidebar] = useState<SidebarModuleId[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ehr/me/layout')
      if (!res.ok) throw new Error('Failed to load')
      const j = (await res.json()) as LayoutResp
      setData(j)
      setWidgets(j.widgets)
      setSidebar(j.sidebar)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const allWidgets = useMemo(() => Object.values(WIDGET_REGISTRY), [])
  const allSidebar = useMemo(() => Object.values(SIDEBAR_REGISTRY), [])

  function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
    const j = i + dir
    if (j < 0 || j >= arr.length) return arr
    const next = arr.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  }

  function toggleWidget(id: WidgetId) {
    setWidgets((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
  }
  function toggleSidebar(id: SidebarModuleId) {
    setSidebar((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/ehr/me/layout', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgets, sidebar }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSavedNote('Saved.')
      setTimeout(() => setSavedNote(null), 2500)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function resetToDefault() {
    if (!confirm('Reset Today widgets and sidebar to the practice default?')) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/ehr/me/layout', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgets: null, sidebar: null }),
      })
      if (!res.ok) throw new Error('Reset failed')
      setSavedNote('Reset to default.')
      setTimeout(() => setSavedNote(null), 2500)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="p-4 text-sm text-gray-500">Loading…</p>

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Layout</h1>
        <p className="text-sm text-gray-600 mt-1">
          Reorder and toggle the widgets that appear on your Today screen
          and the modules in your left sidebar. Practice defaults apply
          if you reset.
        </p>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {savedNote && (
        <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">{savedNote}</div>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Today widgets</h2>
        <ul className="rounded border bg-white divide-y">
          {widgets.map((id, i) => {
            const meta = WIDGET_REGISTRY[id]
            if (!meta) return null
            return (
              <li key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1">
                  <span className="font-medium">{meta.name}</span>
                  <span className="block text-xs text-gray-500">{meta.description}</span>
                </span>
                <button onClick={() => setWidgets(move(widgets, i, -1))}
                        disabled={i === 0}
                        className="text-gray-500 hover:underline disabled:opacity-30">↑</button>
                <button onClick={() => setWidgets(move(widgets, i, 1))}
                        disabled={i === widgets.length - 1}
                        className="text-gray-500 hover:underline disabled:opacity-30">↓</button>
                <button onClick={() => toggleWidget(id)}
                        className="text-red-600 hover:underline">Hide</button>
              </li>
            )
          })}
        </ul>
        {/* Hidden widgets */}
        {allWidgets.filter((w) => !widgets.includes(w.id)).length > 0 && (
          <div className="text-sm">
            <p className="text-gray-600 mb-1">Hidden widgets:</p>
            <div className="flex flex-wrap gap-2">
              {allWidgets.filter((w) => !widgets.includes(w.id)).map((w) => (
                <button key={w.id} onClick={() => toggleWidget(w.id)}
                        className="border rounded px-2 py-0.5 text-xs hover:bg-gray-50">
                  + {w.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Sidebar modules</h2>
        <ul className="rounded border bg-white divide-y">
          {sidebar.map((id, i) => {
            const meta = SIDEBAR_REGISTRY[id]
            if (!meta) return null
            return (
              <li key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 font-medium">{meta.label}</span>
                <button onClick={() => setSidebar(move(sidebar, i, -1))}
                        disabled={i === 0}
                        className="text-gray-500 hover:underline disabled:opacity-30">↑</button>
                <button onClick={() => setSidebar(move(sidebar, i, 1))}
                        disabled={i === sidebar.length - 1}
                        className="text-gray-500 hover:underline disabled:opacity-30">↓</button>
                <button onClick={() => toggleSidebar(id)}
                        className="text-red-600 hover:underline">Hide</button>
              </li>
            )
          })}
        </ul>
        {allSidebar.filter((m) => !sidebar.includes(m.id)).length > 0 && (
          <div className="text-sm">
            <p className="text-gray-600 mb-1">Hidden modules:</p>
            <div className="flex flex-wrap gap-2">
              {allSidebar.filter((m) => !sidebar.includes(m.id)).map((m) => (
                <button key={m.id} onClick={() => toggleSidebar(m.id)}
                        className="border rounded px-2 py-0.5 text-xs hover:bg-gray-50">
                  + {m.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save layout'}
        </button>
        <button
          onClick={resetToDefault}
          disabled={saving}
          className="text-sm text-gray-600 hover:underline disabled:opacity-50"
        >
          Reset to practice default
        </button>
      </div>
    </div>
  )
}

// app/dashboard/ehr/note-templates/page.tsx
//
// W44 T5 — practice-scoped custom note templates manager.

'use client'

import { useEffect, useState } from 'react'

type Section = { key?: string; label: string; helper?: string }
type Template = {
  id: string
  name: string
  description: string | null
  sections: Section[]
  archived_at: string | null
  updated_at: string
}

export default function CustomNoteTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sections, setSections] = useState<Section[]>([{ label: '' }])
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ehr/note-templates?archived=true')
      if (!res.ok) throw new Error('Failed to load')
      const j = await res.json()
      setTemplates(j.templates || [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function updateSection(i: number, patch: Partial<Section>) {
    setSections(sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function addSection() { setSections([...sections, { label: '' }]) }
  function removeSection(i: number) { setSections(sections.filter((_, idx) => idx !== i)) }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/ehr/note-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || undefined,
          sections: sections.filter((s) => s.label.trim().length > 0),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Save failed')
      }
      setName('')
      setDescription('')
      setSections([{ label: '' }])
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function archive(id: string, archived: boolean) {
    if (!confirm(archived ? 'Archive this template?' : 'Unarchive this template?')) return
    const res = await fetch(`/api/ehr/note-templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
    })
    if (res.ok) await load()
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Custom note templates</h1>
        <p className="text-sm text-gray-600 mt-1">
          Define your practice's house-style note templates with named
          sections. Therapists can pick a template at note creation;
          the AI clean-into-format step respects your custom section
          names.
        </p>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded border bg-white p-4 space-y-3">
        <h2 className="font-medium">Create template</h2>
        <label className="block text-sm">
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Trauma Recovery Note"
            className="block w-full border rounded px-2 py-1 mt-1"
          />
        </label>
        <label className="block text-sm">
          Description (optional)
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="block w-full border rounded px-2 py-1 mt-1"
          />
        </label>

        <div>
          <div className="text-sm font-medium mb-1">Sections</div>
          <div className="space-y-2">
            {sections.map((s, i) => (
              <div key={i} className="flex gap-2 items-start">
                <div className="flex-1 space-y-1">
                  <input
                    type="text"
                    value={s.label}
                    onChange={(e) => updateSection(i, { label: e.target.value })}
                    placeholder="Section label (e.g. Trigger Identified)"
                    className="block w-full border rounded px-2 py-1 text-sm"
                  />
                  <input
                    type="text"
                    value={s.helper || ''}
                    onChange={(e) => updateSection(i, { helper: e.target.value })}
                    placeholder="Helper text (optional)"
                    className="block w-full border rounded px-2 py-1 text-xs text-gray-600"
                  />
                </div>
                <button
                  onClick={() => removeSection(i)}
                  className="text-xs text-red-600 hover:underline mt-2"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addSection}
            className="mt-2 text-sm text-[#1f375d] hover:underline"
          >
            + Add section
          </button>
        </div>

        <button
          onClick={save}
          disabled={saving || !name.trim() || sections.every((s) => !s.label.trim())}
          className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save template'}
        </button>
      </section>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-gray-500">No custom templates yet.</p>
      ) : (
        <ul className="space-y-3">
          {templates.map((t) => (
            <li
              key={t.id}
              className={`rounded border bg-white p-3 ${t.archived_at ? 'opacity-60' : ''}`}
            >
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1">
                  <div className="font-medium">{t.name}</div>
                  {t.description && <div className="text-sm text-gray-600">{t.description}</div>}
                  <ol className="text-xs text-gray-500 mt-1 list-decimal pl-4">
                    {t.sections.map((s, i) => (<li key={i}>{s.label}</li>))}
                  </ol>
                </div>
                <button
                  onClick={() => archive(t.id, !t.archived_at)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  {t.archived_at ? 'Unarchive' : 'Archive'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

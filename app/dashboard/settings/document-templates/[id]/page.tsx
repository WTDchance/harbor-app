// W52 D1 — edit a single document template.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

const CATEGORIES = [
  ['hipaa_npp', 'HIPAA Notice of Privacy Practices'],
  ['consent_for_treatment', 'Consent for Treatment'],
  ['release_of_information', 'Release of Information'],
  ['telehealth_consent', 'Telehealth Consent'],
  ['financial_responsibility', 'Financial Responsibility'],
  ['treatment_plan', 'Treatment Plan'],
  ['other', 'Other'],
]

export default function DocTemplateEditPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id
  const [name, setName] = useState('')
  const [category, setCategory] = useState('consent_for_treatment')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/ehr/practice/document-templates')
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        const t = (j.templates ?? []).find((x: any) => x.id === id)
        if (!t) { setError('Not found'); return }
        setName(t.name); setCategory(t.category); setBody(t.body_html)
      })
      .finally(() => setLoading(false))
    return () => { cancelled = true }
  }, [id])

  async function save() {
    setSaving(true); setError(null)
    try {
      const r = await fetch(`/api/ehr/practice/document-templates/${id}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, category, body_html: body }),
      })
      const j = await r.json()
      if (!r.ok) setError(j.error || 'Save failed')
      else setSavedAt(new Date())
    } finally { setSaving(false) }
  }

  async function archive() {
    if (!confirm('Archive this template? Patients with pending requests still see the snapshot.')) return
    await fetch(`/api/ehr/practice/document-templates/${id}`, { method: 'DELETE' })
    router.push('/dashboard/settings/document-templates')
  }

  if (loading) return <div className="max-w-4xl mx-auto p-6 text-sm text-gray-400">Loading…</div>
  if (error) return <div className="max-w-4xl mx-auto p-6 text-sm text-red-600">{error}</div>

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Link href="/dashboard/settings/document-templates" className="text-sm text-gray-500 hover:text-gray-700">← All templates</Link>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input value={name} onChange={e => setName(e.target.value)}
          className="sm:col-span-2 border border-gray-300 rounded px-3 py-2 text-base font-semibold"
          placeholder="Template name" />
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm">
          {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <textarea value={body} onChange={e => setBody(e.target.value)} rows={20}
        placeholder="<h1>Title</h1>&#10;<p>Use {{patient_full_name}}, {{patient_dob}}, {{practice_name}}, {{today}} as variables.</p>"
        className="mt-4 w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono" />

      <div className="mt-3 flex items-center gap-2">
        <button onClick={save} disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={archive} className="text-sm text-red-600 hover:text-red-800">Archive</button>
        {savedAt && <span className="text-xs text-gray-400">Saved {savedAt.toLocaleTimeString()}</span>}
      </div>

      <div className="mt-6 border border-gray-200 rounded p-4 bg-gray-50/50">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Preview</div>
        <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: body }} />
      </div>
    </div>
  )
}

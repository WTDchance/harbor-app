// app/dashboard/settings/forms/page.tsx
//
// W49 D1 — list of practice custom forms.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Form {
  id: string
  name: string
  slug: string
  description: string | null
  status: 'draft' | 'published' | 'archived'
  schema: any[]
  created_at: string
  updated_at: string
}

export default function FormsListPage() {
  const router = useRouter()
  const [forms, setForms] = useState<Form[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/ehr/practice/custom-forms')
      const j = await res.json()
      if (res.ok) setForms(j.forms || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  async function create() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/ehr/practice/custom-forms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), schema: [] }),
      })
      const j = await res.json()
      if (!res.ok) { alert(j.error || 'Failed'); return }
      router.push(`/dashboard/settings/forms/${j.form.id}`)
    } finally { setCreating(false) }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Custom Forms</h1>
          <p className="text-sm text-gray-500 mt-1">Build intake, screening, and consent forms tailored to your practice.</p>
        </div>
        <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-gray-700">← Back to settings</Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New form name (e.g., Adolescent Intake)"
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm"
            onKeyDown={(e) => { if (e.key === 'Enter') void create() }}
          />
          <button
            onClick={create}
            disabled={creating || !newName.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create form'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : forms.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-sm text-gray-500">
          No custom forms yet. Create one above to get started.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {forms.map((f) => (
            <Link
              key={f.id}
              href={`/dashboard/settings/forms/${f.id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-gray-50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{f.name}</span>
                  <StatusPill status={f.status} />
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {f.schema?.length ?? 0} fields · /{f.slug}
                </div>
              </div>
              <div className="text-xs text-gray-400">
                Updated {new Date(f.updated_at).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const cls = status === 'published' ? 'bg-green-50 text-green-700 border-green-200'
    : status === 'archived' ? 'bg-gray-100 text-gray-600 border-gray-200'
    : 'bg-yellow-50 text-yellow-700 border-yellow-200'
  return <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${cls}`}>{status}</span>
}

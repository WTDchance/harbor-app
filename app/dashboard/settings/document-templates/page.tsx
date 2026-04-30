// W52 D1 — list of document templates.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Template {
  id: string; name: string; category: string;
  body_html: string; status: string; updated_at: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  hipaa_npp: 'HIPAA Notice of Privacy Practices',
  consent_for_treatment: 'Consent for Treatment',
  release_of_information: 'Release of Information',
  telehealth_consent: 'Telehealth Consent',
  financial_responsibility: 'Financial Responsibility',
  treatment_plan: 'Treatment Plan',
  other: 'Other',
}

export default function DocTemplatesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  async function load() {
    setLoading(true)
    const r = await fetch('/api/ehr/practice/document-templates')
    const j = await r.json()
    if (r.ok) setTemplates(j.templates ?? [])
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  async function create() {
    setCreating(true)
    try {
      const r = await fetch('/api/ehr/practice/document-templates', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled document', category: 'consent_for_treatment', body_html: '<h1>Untitled</h1>' }),
      })
      const j = await r.json()
      if (r.ok) router.push(`/dashboard/settings/document-templates/${j.template.id}`)
    } finally { setCreating(false) }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-gray-700">← Back to settings</Link>
          <h1 className="text-2xl font-semibold text-gray-900 mt-2">Document templates</h1>
          <p className="text-sm text-gray-500 mt-1">Templates Ellie sends from receptionist calls and you send from patient detail.</p>
        </div>
        <button onClick={create} disabled={creating}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded-md">
          {creating ? 'Creating…' : '+ New template'}
        </button>
      </div>

      {loading ? <div className="mt-6 text-sm text-gray-400">Loading…</div> :
       templates.length === 0 ? (
        <div className="mt-6 bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-sm text-gray-500">
          No templates yet — create one above to get started.
        </div>
       ) : (
        <div className="mt-6 bg-white border border-gray-200 rounded-xl divide-y">
          {templates.map(t => (
            <Link key={t.id} href={`/dashboard/settings/document-templates/${t.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
              <div>
                <div className="font-medium text-gray-900">{t.name}</div>
                <div className="text-xs text-gray-500">{CATEGORY_LABEL[t.category] ?? t.category}</div>
              </div>
              <div className="text-xs text-gray-400">Updated {new Date(t.updated_at).toLocaleDateString()}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// app/dashboard/ehr/treatment-plan-templates/page.tsx
//
// W43 T3 — practice-level treatment plan template library.
// Therapists can browse templates by diagnosis, edit/archive existing
// ones, and seed a starter library for new practices.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Template = {
  id: string
  name: string
  description: string | null
  diagnoses: string[]
  presenting_problem: string | null
  goals: Array<{ text: string; target_date?: string; objectives?: any[] }>
  frequency: string | null
  archived_at: string | null
  updated_at: string
}

export default function TreatmentPlanTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [seedResult, setSeedResult] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ehr/treatment-plan-templates')
      if (!res.ok) throw new Error('Failed to load templates')
      const j = await res.json()
      setTemplates(j.templates || [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function seedDefaults() {
    setSeeding(true)
    setSeedResult(null)
    try {
      const res = await fetch('/api/ehr/treatment-plan-templates/seed-defaults', {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Seed failed')
      const j = await res.json()
      setSeedResult(`Created ${j.created_count} templates, skipped ${j.skipped_count} existing.`)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSeeding(false)
    }
  }

  async function archive(id: string, archived: boolean) {
    if (!confirm(archived ? 'Archive this template?' : 'Unarchive this template?')) return
    const res = await fetch(`/api/ehr/treatment-plan-templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
    })
    if (res.ok) await load()
  }

  const filtered = filter
    ? templates.filter(
        (t) =>
          t.name.toLowerCase().includes(filter.toLowerCase()) ||
          t.diagnoses.some((d) => d.toLowerCase().includes(filter.toLowerCase())),
      )
    : templates

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Treatment plan templates</h1>
          <p className="text-sm text-gray-600 mt-1">
            Reusable scaffolding for common diagnoses. Clone a template into a
            patient's chart to start a new treatment plan with goals, objectives,
            and interventions pre-filled.
          </p>
        </div>
        {templates.length === 0 && !loading && (
          <button
            onClick={seedDefaults}
            disabled={seeding}
            className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm whitespace-nowrap disabled:opacity-50"
          >
            {seeding ? 'Seeding…' : 'Seed starter library'}
          </button>
        )}
      </div>

      {seedResult && (
        <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
          {seedResult}
        </div>
      )}

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <input
        type="text"
        placeholder="Filter by name or ICD-10 code (e.g. F32)"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full border rounded px-3 py-2 text-sm"
      />

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500">
          {templates.length === 0
            ? 'No templates yet. Seed the starter library to create five common templates.'
            : 'No matches.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((t) => (
            <li
              key={t.id}
              className={`rounded border bg-white p-4 ${t.archived_at ? 'opacity-60' : ''}`}
            >
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="font-medium">
                    <Link href={`/dashboard/ehr/treatment-plan-templates/${t.id}`} className="hover:underline">
                      {t.name}
                    </Link>
                  </div>
                  {t.description && (
                    <div className="text-sm text-gray-600 mt-0.5">{t.description}</div>
                  )}
                  <div className="text-xs text-gray-500 mt-2">
                    {t.diagnoses.length > 0 && (
                      <span className="mr-3">{t.diagnoses.join(', ')}</span>
                    )}
                    <span>{t.goals.length} goal{t.goals.length === 1 ? '' : 's'}</span>
                    {t.frequency && <span className="ml-3">· {t.frequency}</span>}
                  </div>
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

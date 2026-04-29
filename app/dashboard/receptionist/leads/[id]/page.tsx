// app/dashboard/receptionist/leads/[id]/page.tsx
//
// W51 D2 — lead detail + edit + mark-exported.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

interface Lead {
  id: string
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  phone_e164: string | null
  email: string | null
  insurance_payer: string | null
  insurance_member_id: string | null
  insurance_group_number: string | null
  reason_for_visit: string | null
  urgency_level: 'low' | 'medium' | 'high' | 'crisis' | null
  preferred_therapist: string | null
  preferred_appointment_window: string | null
  notes: string | null
  status: 'new' | 'contacted' | 'scheduled' | 'imported_to_ehr' | 'discarded'
  exported_at: string | null
  call_id: string | null
  created_at: string
  updated_at: string
}

const FIELD_LABELS: Record<keyof Lead | string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  date_of_birth: 'Date of birth',
  phone_e164: 'Phone',
  email: 'Email',
  insurance_payer: 'Insurance carrier',
  insurance_member_id: 'Member ID',
  insurance_group_number: 'Group number',
  reason_for_visit: 'Reason for visit',
  urgency_level: 'Urgency',
  preferred_therapist: 'Preferred therapist',
  preferred_appointment_window: 'Preferred window',
  notes: 'Notes',
}

const EDIT_FIELDS = Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id
  const [lead, setLead] = useState<Lead | null>(null)
  const [draft, setDraft] = useState<Partial<Lead>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const r = await fetch(`/api/reception/leads/${id}`)
    const j = await r.json()
    if (r.ok) { setLead(j.lead); setDraft({}) }
    else setError(j.error || 'Failed to load')
  }
  useEffect(() => { void load() }, [id])

  async function save() {
    if (Object.keys(draft).length === 0) return
    setSaving(true); setError(null)
    try {
      const r = await fetch(`/api/reception/leads/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft),
      })
      const j = await r.json()
      if (!r.ok) setError(j.error || 'Save failed')
      else { setLead(j.lead); setDraft({}) }
    } finally { setSaving(false) }
  }

  async function changeStatus(next: Lead['status']) {
    setSaving(true)
    try {
      const r = await fetch(`/api/reception/leads/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: next }),
      })
      const j = await r.json()
      if (r.ok) setLead(j.lead)
    } finally { setSaving(false) }
  }

  async function markExported() {
    setSaving(true)
    try {
      const r = await fetch(`/api/reception/leads/${id}/mark-exported`, { method: 'POST' })
      const j = await r.json()
      if (r.ok) await load()
    } finally { setSaving(false) }
  }

  if (error) return <div className="max-w-3xl mx-auto p-6 text-sm text-red-600">{error}</div>
  if (!lead) return <div className="max-w-3xl mx-auto p-6 text-sm text-gray-400">Loading…</div>

  const merged = { ...lead, ...draft } as Lead
  const dirty = Object.keys(draft).length > 0

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href="/dashboard/receptionist/leads" className="text-sm text-gray-500 hover:text-gray-700">← All leads</Link>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mt-2">
        <h1 className="text-2xl font-semibold text-gray-900">
          {[merged.first_name, merged.last_name].filter(Boolean).join(' ') || '— Unnamed lead —'}
        </h1>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide px-2 py-1 rounded border border-gray-300 bg-gray-50 text-gray-700">{lead.status.replace(/_/g, ' ')}</span>
          {lead.call_id && (
            <Link href={`/dashboard/receptionist/calls/${lead.call_id}`} className="text-sm text-blue-600 hover:underline">
              View source call →
            </Link>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {EDIT_FIELDS.map(f => (
          <div key={f as string}>
            <label className="text-[10px] uppercase tracking-wide text-gray-500">{FIELD_LABELS[f as string]}</label>
            {f === 'urgency_level' ? (
              <select
                value={(merged[f as keyof Lead] as string) ?? ''}
                onChange={e => setDraft(d => ({ ...d, [f]: e.target.value || null } as any))}
                className="w-full mt-1 border border-gray-300 rounded px-2 py-1 text-sm"
              >
                <option value="">—</option>
                <option value="low">Low</option><option value="medium">Medium</option>
                <option value="high">High</option><option value="crisis">Crisis</option>
              </select>
            ) : f === 'notes' || f === 'reason_for_visit' ? (
              <textarea
                value={(merged[f as keyof Lead] as string) ?? ''}
                onChange={e => setDraft(d => ({ ...d, [f]: e.target.value } as any))}
                rows={2}
                className="w-full mt-1 border border-gray-300 rounded px-2 py-1 text-sm"
              />
            ) : (
              <input
                type={f === 'date_of_birth' ? 'date' : 'text'}
                value={(merged[f as keyof Lead] as string) ?? ''}
                onChange={e => setDraft(d => ({ ...d, [f]: e.target.value } as any))}
                className="w-full mt-1 border border-gray-300 rounded px-2 py-1 text-sm"
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 items-center">
        <button onClick={save} disabled={!dirty || saving}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50">
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'No unsaved changes'}
        </button>
        {lead.status !== 'imported_to_ehr' ? (
          <button onClick={markExported} className="border border-gray-300 hover:bg-gray-50 text-sm rounded-md px-3 py-2">
            Mark imported to EHR
          </button>
        ) : (
          <span className="text-xs text-gray-500">Exported {lead.exported_at ? new Date(lead.exported_at).toLocaleString() : ''}</span>
        )}
        <select value={lead.status} onChange={e => changeStatus(e.target.value as Lead['status'])}
          className="border border-gray-300 rounded px-2 py-2 text-sm">
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="scheduled">Scheduled</option>
          <option value="imported_to_ehr">Imported to EHR</option>
          <option value="discarded">Discarded</option>
        </select>
      </div>
    </div>
  )
}

// app/dashboard/receptionist/leads/page.tsx
//
// W51 D2 — list of reception leads.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Lead {
  id: string
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  phone_e164: string | null
  email: string | null
  insurance_payer: string | null
  reason_for_visit: string | null
  urgency_level: 'low' | 'medium' | 'high' | 'crisis' | null
  status: 'new' | 'contacted' | 'scheduled' | 'imported_to_ehr' | 'discarded'
  exported_at: string | null
  created_at: string
  call_id: string | null
}

const STATUS_CLS: Record<Lead['status'], string> = {
  new:              'bg-blue-50 border-blue-300 text-blue-700',
  contacted:        'bg-emerald-50 border-emerald-300 text-emerald-700',
  scheduled:        'bg-purple-50 border-purple-300 text-purple-700',
  imported_to_ehr:  'bg-gray-100 border-gray-300 text-gray-600',
  discarded:        'bg-stone-100 border-stone-300 text-stone-500',
}

const URGENCY_CLS: Record<NonNullable<Lead['urgency_level']>, string> = {
  low:    'bg-stone-50 border-stone-300 text-stone-700',
  medium: 'bg-amber-50 border-amber-300 text-amber-700',
  high:   'bg-orange-50 border-orange-300 text-orange-700',
  crisis: 'bg-red-50 border-red-300 text-red-700',
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [status, setStatus] = useState<'all' | Lead['status']>('all')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  async function load() {
    const sp = new URLSearchParams()
    if (status !== 'all') sp.set('status', status)
    if (debounced.trim()) sp.set('search', debounced.trim())
    const r = await fetch(`/api/reception/leads?${sp}`)
    const j = await r.json()
    if (r.ok) setLeads(j.leads ?? [])
  }
  useEffect(() => { void load() }, [status, debounced])

  function exportCsv() {
    const sp = new URLSearchParams()
    if (status !== 'all') sp.set('status', status)
    sp.set('range', '90d')
    window.location.href = `/api/reception/leads/export.csv?${sp}`
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500">Receptionist-captured intakes ready for handoff to your EHR.</p>
        </div>
        <button onClick={exportCsv} className="border border-gray-300 hover:bg-gray-50 text-sm rounded-md px-3 py-1.5">
          Export CSV
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-3 mt-4 mb-4 flex flex-wrap items-center gap-2">
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email, phone…"
          className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm min-w-[180px]"
        />
        <select value={status} onChange={e => setStatus(e.target.value as any)}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          <option value="all">All statuses</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="scheduled">Scheduled</option>
          <option value="imported_to_ehr">Imported to EHR</option>
          <option value="discarded">Discarded</option>
        </select>
      </div>

      {leads === null ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : leads.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-sm text-gray-500">
          No leads yet. They'll appear here as the receptionist captures intake calls.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y">
          {leads.map(l => {
            const name = [l.first_name, l.last_name].filter(Boolean).join(' ') || '— Unnamed —'
            return (
              <Link key={l.id} href={`/dashboard/receptionist/leads/${l.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{name}</span>
                    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_CLS[l.status]}`}>
                      {l.status.replace(/_/g, ' ')}
                    </span>
                    {l.urgency_level && (
                      <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${URGENCY_CLS[l.urgency_level]}`}>
                        {l.urgency_level}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-3">
                    {l.phone_e164 && <span>{l.phone_e164}</span>}
                    {l.email && <span>{l.email}</span>}
                    {l.insurance_payer && <span>{l.insurance_payer}</span>}
                    <span className="text-gray-400">{new Date(l.created_at).toLocaleString()}</span>
                  </div>
                </div>
                <span className="text-gray-300">›</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

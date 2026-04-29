// app/dashboard/settings/therapists/[id]/credentials/page.tsx
//
// W49 D3 — tabbed credentials editor: licenses / specialties / payers / CE.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type Tab = 'licenses' | 'specialties' | 'payers' | 'ce'

interface License {
  id: string; type: string; state: string; license_number: string
  issued_at: string | null; expires_at: string | null
  status: 'active' | 'expired' | 'suspended' | 'inactive'
  document_url: string | null; notes: string | null
  last_warning_threshold: number | null
}
interface Specialty { id: string; specialty: string; certified: boolean; cert_url: string | null }
interface Enrollment {
  id: string; payer_name: string; npi: string | null; taxonomy_code: string | null
  enrollment_status: 'pending' | 'enrolled' | 'denied' | 'terminated'
  effective_from: string | null; effective_to: string | null
}
interface CECredit {
  id: string; course_name: string; provider: string | null; hours: number | string
  category: string | null; completed_at: string; cert_url: string | null
}

export default function CredentialsPage() {
  const params = useParams<{ id: string }>()
  const therapistId = params.id
  const [tab, setTab] = useState<Tab>('licenses')

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <Link href="/dashboard/settings" className="text-sm text-gray-500 hover:text-gray-700">← Back to settings</Link>
      <h1 className="text-2xl font-semibold text-gray-900 mt-2">Therapist credentials</h1>

      <div className="border-b border-gray-200 mt-4 flex gap-6">
        {(['licenses', 'specialties', 'payers', 'ce'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-2 text-sm font-medium border-b-2 ${tab === t ? 'border-blue-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {tabLabel(t)}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === 'licenses' && <LicensesTab therapistId={therapistId} />}
        {tab === 'specialties' && <SpecialtiesTab therapistId={therapistId} />}
        {tab === 'payers' && <PayersTab therapistId={therapistId} />}
        {tab === 'ce' && <CETab therapistId={therapistId} />}
      </div>
    </div>
  )
}

function tabLabel(t: Tab) {
  return t === 'licenses' ? 'Licenses' : t === 'specialties' ? 'Specialties' : t === 'payers' ? 'Payer enrollments' : 'CE credits'
}

function expiryPill(expires: string | null) {
  if (!expires) return null
  const days = Math.ceil((new Date(expires).getTime() - Date.now()) / (24 * 3600 * 1000))
  if (days < 0) return <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-red-300 bg-red-50 text-red-700">Expired</span>
  if (days <= 7) return <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-red-300 bg-red-50 text-red-700">Expires in {days}d</span>
  if (days <= 30) return <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-orange-300 bg-orange-50 text-orange-700">Expires in {days}d</span>
  if (days <= 60) return <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-yellow-300 bg-yellow-50 text-yellow-700">Expires in {days}d</span>
  return <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border border-gray-200 text-gray-600">Expires {expires}</span>
}

function LicensesTab({ therapistId }: { therapistId: string }) {
  const [items, setItems] = useState<License[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({ type: 'LCSW', state: '', license_number: '', issued_at: '', expires_at: '' })
  async function load() {
    setLoading(true)
    const r = await fetch(`/api/ehr/therapists/${therapistId}/licenses`)
    const j = await r.json(); if (r.ok) setItems(j.licenses ?? []); setLoading(false)
  }
  useEffect(() => { void load() }, [therapistId])

  async function add() {
    if (!draft.state || !draft.license_number) return
    const r = await fetch(`/api/ehr/therapists/${therapistId}/licenses`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
    if (r.ok) { setDraft({ type: 'LCSW', state: '', license_number: '', issued_at: '', expires_at: '' }); void load() }
  }
  async function del(id: string) {
    if (!confirm('Delete this license?')) return
    const r = await fetch(`/api/ehr/therapists/${therapistId}/licenses/${id}`, { method: 'DELETE' })
    if (r.ok) void load()
  }

  if (loading) return <div className="text-sm text-gray-500">Loading…</div>
  return (
    <>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 grid grid-cols-2 sm:grid-cols-6 gap-2">
        <input className="border rounded px-2 py-1 text-sm" placeholder="Type (LCSW)" value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm" placeholder="State (OR)" maxLength={2} value={draft.state} onChange={e => setDraft({ ...draft, state: e.target.value.toUpperCase() })} />
        <input className="border rounded px-2 py-1 text-sm" placeholder="License #" value={draft.license_number} onChange={e => setDraft({ ...draft, license_number: e.target.value })} />
        <input type="date" className="border rounded px-2 py-1 text-sm" value={draft.issued_at} onChange={e => setDraft({ ...draft, issued_at: e.target.value })} />
        <input type="date" className="border rounded px-2 py-1 text-sm" value={draft.expires_at} onChange={e => setDraft({ ...draft, expires_at: e.target.value })} />
        <button onClick={add} className="bg-blue-600 hover:bg-blue-700 text-white text-sm rounded px-3 py-1.5">Add</button>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl divide-y">
        {items.length === 0 && <div className="p-6 text-center text-sm text-gray-500">No licenses yet.</div>}
        {items.map(l => (
          <div key={l.id} className="px-4 py-3 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{l.type} · {l.state}</span>
                <span className="text-xs text-gray-500">#{l.license_number}</span>
                {expiryPill(l.expires_at)}
              </div>
              <div className="text-xs text-gray-500">
                {l.issued_at && <>Issued {l.issued_at} · </>}
                {l.expires_at && <>Expires {l.expires_at}</>}
              </div>
            </div>
            <button onClick={() => del(l.id)} className="text-xs text-red-600 hover:text-red-800">Remove</button>
          </div>
        ))}
      </div>
    </>
  )
}

function SpecialtiesTab({ therapistId }: { therapistId: string }) {
  const [items, setItems] = useState<Specialty[]>([])
  const [val, setVal] = useState('')
  async function load() {
    const r = await fetch(`/api/ehr/therapists/${therapistId}/specialties`)
    const j = await r.json(); if (r.ok) setItems(j.specialties ?? [])
  }
  useEffect(() => { void load() }, [therapistId])
  async function add() {
    if (!val.trim()) return
    const r = await fetch(`/api/ehr/therapists/${therapistId}/specialties`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ specialty: val.trim() }) })
    if (r.ok) { setVal(''); void load() }
  }
  async function del(id: string) {
    const r = await fetch(`/api/ehr/therapists/${therapistId}/specialties/${id}`, { method: 'DELETE' })
    if (r.ok) void load()
  }
  return (
    <>
      <div className="flex gap-2 mb-4">
        <input className="flex-1 border rounded px-3 py-2 text-sm" placeholder="Add a specialty (CBT, EMDR, Trauma…)" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button onClick={add} className="bg-blue-600 hover:bg-blue-700 text-white text-sm rounded px-3 py-2">Add</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.length === 0 && <div className="text-sm text-gray-500">None.</div>}
        {items.map(s => (
          <span key={s.id} className="inline-flex items-center gap-1 bg-gray-100 border border-gray-200 rounded-full px-3 py-1 text-sm">
            {s.specialty}
            <button onClick={() => del(s.id)} className="text-gray-400 hover:text-red-600">×</button>
          </span>
        ))}
      </div>
    </>
  )
}

function PayersTab({ therapistId }: { therapistId: string }) {
  const [items, setItems] = useState<Enrollment[]>([])
  const [draft, setDraft] = useState({ payer_name: '', npi: '', taxonomy_code: '', enrollment_status: 'pending', effective_from: '', effective_to: '' })
  async function load() {
    const r = await fetch(`/api/ehr/therapists/${therapistId}/payer-enrollments`)
    const j = await r.json(); if (r.ok) setItems(j.enrollments ?? [])
  }
  useEffect(() => { void load() }, [therapistId])
  async function add() {
    if (!draft.payer_name) return
    const r = await fetch(`/api/ehr/therapists/${therapistId}/payer-enrollments`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
    if (r.ok) { setDraft({ payer_name: '', npi: '', taxonomy_code: '', enrollment_status: 'pending', effective_from: '', effective_to: '' }); void load() }
  }
  async function del(id: string) {
    const r = await fetch(`/api/ehr/therapists/${therapistId}/payer-enrollments/${id}`, { method: 'DELETE' })
    if (r.ok) void load()
  }
  return (
    <>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 grid grid-cols-2 sm:grid-cols-6 gap-2">
        <input className="border rounded px-2 py-1 text-sm sm:col-span-2" placeholder="Payer (Aetna)" value={draft.payer_name} onChange={e => setDraft({ ...draft, payer_name: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm" placeholder="NPI" value={draft.npi} onChange={e => setDraft({ ...draft, npi: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm" placeholder="Taxonomy" value={draft.taxonomy_code} onChange={e => setDraft({ ...draft, taxonomy_code: e.target.value })} />
        <select className="border rounded px-2 py-1 text-sm" value={draft.enrollment_status} onChange={e => setDraft({ ...draft, enrollment_status: e.target.value })}>
          <option value="pending">Pending</option><option value="enrolled">Enrolled</option><option value="denied">Denied</option><option value="terminated">Terminated</option>
        </select>
        <button onClick={add} className="bg-blue-600 hover:bg-blue-700 text-white text-sm rounded px-3 py-1.5">Add</button>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl divide-y">
        {items.length === 0 && <div className="p-6 text-center text-sm text-gray-500">No payer enrollments yet.</div>}
        {items.map(e => (
          <div key={e.id} className="px-4 py-3 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{e.payer_name}</span>
                <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${
                  e.enrollment_status === 'enrolled' ? 'bg-green-50 border-green-300 text-green-700' :
                  e.enrollment_status === 'denied' ? 'bg-red-50 border-red-300 text-red-700' :
                  e.enrollment_status === 'terminated' ? 'bg-gray-100 border-gray-300 text-gray-600' :
                  'bg-yellow-50 border-yellow-300 text-yellow-700'
                }`}>{e.enrollment_status}</span>
              </div>
              <div className="text-xs text-gray-500">
                {e.npi && <>NPI {e.npi} · </>}{e.taxonomy_code && <>{e.taxonomy_code} · </>}
                {e.effective_from && <>From {e.effective_from}</>}{e.effective_to && <> · To {e.effective_to}</>}
              </div>
            </div>
            <button onClick={() => del(e.id)} className="text-xs text-red-600 hover:text-red-800">Remove</button>
          </div>
        ))}
      </div>
    </>
  )
}

function CETab({ therapistId }: { therapistId: string }) {
  const [items, setItems] = useState<CECredit[]>([])
  const [draft, setDraft] = useState({ course_name: '', provider: '', hours: '', category: '', completed_at: '', cert_url: '' })
  async function load() {
    const r = await fetch(`/api/ehr/therapists/${therapistId}/ce-credits`)
    const j = await r.json(); if (r.ok) setItems(j.credits ?? [])
  }
  useEffect(() => { void load() }, [therapistId])
  const total = useMemo(() => items.reduce((a, c) => a + Number(c.hours || 0), 0), [items])

  async function add() {
    if (!draft.course_name || !draft.completed_at || !draft.hours) return
    const r = await fetch(`/api/ehr/therapists/${therapistId}/ce-credits`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...draft, hours: Number(draft.hours) }) })
    if (r.ok) { setDraft({ course_name: '', provider: '', hours: '', category: '', completed_at: '', cert_url: '' }); void load() }
  }
  async function del(id: string) {
    const r = await fetch(`/api/ehr/therapists/${therapistId}/ce-credits/${id}`, { method: 'DELETE' })
    if (r.ok) void load()
  }
  return (
    <>
      <div className="text-sm text-gray-700 mb-3">Total CE hours: <strong>{total}</strong></div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 grid grid-cols-2 sm:grid-cols-6 gap-2">
        <input className="border rounded px-2 py-1 text-sm sm:col-span-2" placeholder="Course name" value={draft.course_name} onChange={e => setDraft({ ...draft, course_name: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm" placeholder="Provider" value={draft.provider} onChange={e => setDraft({ ...draft, provider: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm" placeholder="Hours" type="number" step="0.25" value={draft.hours} onChange={e => setDraft({ ...draft, hours: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm" placeholder="Category" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} />
        <input className="border rounded px-2 py-1 text-sm" type="date" value={draft.completed_at} onChange={e => setDraft({ ...draft, completed_at: e.target.value })} />
        <button onClick={add} className="bg-blue-600 hover:bg-blue-700 text-white text-sm rounded px-3 py-1.5 col-span-2 sm:col-span-1">Add</button>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl divide-y">
        {items.length === 0 && <div className="p-6 text-center text-sm text-gray-500">No CE credits yet.</div>}
        {items.map(c => (
          <div key={c.id} className="px-4 py-3 flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900">{c.course_name}</div>
              <div className="text-xs text-gray-500">
                {c.provider && <>{c.provider} · </>}{c.hours} hrs · {c.completed_at}
                {c.category && <> · {c.category}</>}
              </div>
            </div>
            <button onClick={() => del(c.id)} className="text-xs text-red-600 hover:text-red-800">Remove</button>
          </div>
        ))}
      </div>
    </>
  )
}

// app/dashboard/patients/[id]/family/page.tsx
//
// W44 T3 — patient family relationships page. Therapist can browse,
// add, and remove parent/guardian/spouse/etc. links to other patients
// in the same practice.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type RelRow = {
  id: string
  relationship: string
  is_minor_consent: boolean
  notes: string | null
  related_patient_id: string
  related_first_name: string | null
  related_last_name: string | null
  related_dob: string | null
  created_at: string
}

type PatientLite = {
  id: string
  first_name: string | null
  last_name: string | null
  dob: string | null
}

const RELATIONSHIPS = [
  'parent', 'guardian', 'spouse', 'partner', 'child', 'sibling', 'other',
]

export default function FamilyRelationshipsPage() {
  const params = useParams<{ id: string }>()
  const patientId = params?.id as string

  const [rels, setRels] = useState<RelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<PatientLite[]>([])
  const [picked, setPicked] = useState<PatientLite | null>(null)
  const [relationship, setRelationship] = useState('parent')
  const [isMinorConsent, setIsMinorConsent] = useState(false)
  const [notes, setNotes] = useState('')
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/relationships`)
      if (!res.ok) throw new Error('Failed to load')
      const j = await res.json()
      setRels(j.relationships || [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (patientId) void load() }, [patientId])

  async function searchPatients(q: string) {
    setSearch(q)
    if (q.length < 2) { setSearchResults([]); return }
    try {
      const res = await fetch(`/api/ehr/patients?q=${encodeURIComponent(q)}&limit=10`)
      if (!res.ok) return
      const j = await res.json()
      const list: PatientLite[] = (j.patients || j.rows || [])
        .filter((p: PatientLite) => p.id !== patientId)
        .slice(0, 10)
      setSearchResults(list)
    } catch {}
  }

  async function add() {
    if (!picked) return
    setAdding(true)
    setError(null)
    try {
      const res = await fetch(`/api/ehr/patients/${patientId}/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          related_patient_id: picked.id,
          relationship,
          is_minor_consent: isMinorConsent,
          notes: notes || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Failed to add')
      }
      setPicked(null)
      setSearch('')
      setSearchResults([])
      setNotes('')
      setIsMinorConsent(false)
      setRelationship('parent')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAdding(false)
    }
  }

  async function remove(relId: string) {
    if (!confirm('Remove this relationship from both sides?')) return
    try {
      const res = await fetch(
        `/api/ehr/patients/${patientId}/relationships?relationship_id=${relId}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error('Failed to remove')
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const grouped = useMemo(() => {
    const out: Record<string, RelRow[]> = {}
    for (const r of rels) {
      if (!out[r.relationship]) out[r.relationship] = []
      out[r.relationship].push(r)
    }
    return out
  }, [rels])

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Family</h1>
        <p className="text-sm text-gray-600 mt-1">
          Parent, guardian, spouse, and other family relationships to
          patients in this practice. Adding a relationship automatically
          adds the inverse from the other side.
        </p>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <section className="rounded border bg-white p-4 space-y-3">
        <h2 className="font-medium">Add relationship</h2>

        {!picked ? (
          <>
            <label className="block text-sm">
              Search patients
              <input
                type="text"
                value={search}
                onChange={(e) => searchPatients(e.target.value)}
                placeholder="Type a name…"
                className="block w-full border rounded px-2 py-1 mt-1"
              />
            </label>
            {searchResults.length > 0 && (
              <ul className="border rounded divide-y text-sm">
                {searchResults.map((p) => (
                  <li key={p.id} className="px-3 py-2 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setPicked(p)}>
                    {(p.first_name || '') + ' ' + (p.last_name || '')}
                    {p.dob && <span className="text-xs text-gray-500 ml-2">DOB {p.dob}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <div className="text-sm">
              Selected: <span className="font-medium">{(picked.first_name || '') + ' ' + (picked.last_name || '')}</span>
              <button onClick={() => setPicked(null)} className="ml-2 text-xs text-gray-500 hover:underline">change</button>
            </div>
            <label className="block text-sm">
              Relationship
              <select
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                className="block w-full border rounded px-2 py-1 mt-1"
              >
                {RELATIONSHIPS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={isMinorConsent}
                onChange={(e) => setIsMinorConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>This person has consent authority for this patient (parent/guardian of a minor)</span>
            </label>
            <label className="block text-sm">
              Notes (optional)
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="block w-full border rounded px-2 py-1 mt-1"
              />
            </label>
            <button
              onClick={add}
              disabled={adding}
              className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        )}
      </section>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : rels.length === 0 ? (
        <p className="text-sm text-gray-500">No family relationships yet.</p>
      ) : (
        (Object.entries(grouped) as Array<[string, RelRow[]]>).map(([rel, list]) => (
          <section key={rel} className="rounded border bg-white">
            <h2 className="font-medium px-3 py-2 border-b capitalize">{rel}</h2>
            <ul className="divide-y">
              {list.map((r) => (
                <li key={r.id} className="px-3 py-2 flex items-center justify-between">
                  <div className="text-sm">
                    <Link
                      href={`/dashboard/patients/${r.related_patient_id}`}
                      className="font-medium text-[#1f375d] hover:underline"
                    >
                      {(r.related_first_name || '') + ' ' + (r.related_last_name || '')}
                    </Link>
                    {r.is_minor_consent && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                        consent authority
                      </span>
                    )}
                    {r.notes && <div className="text-xs text-gray-500 mt-0.5">{r.notes}</div>}
                  </div>
                  <button
                    onClick={() => remove(r.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

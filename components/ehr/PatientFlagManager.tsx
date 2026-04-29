// components/ehr/PatientFlagManager.tsx
//
// W49 D5 — modal flag manager. Shows current flags, lets you add or
// clear them with optional notes.

'use client'

import { useEffect, useState } from 'react'
import { Flag } from 'lucide-react'
import { PATIENT_FLAG_META, PATIENT_FLAG_TYPES, type PatientFlagType } from '@/lib/ehr/patient-flags'

interface FlagRow { id: string; type: PatientFlagType; notes: string | null; set_at: string }

export default function PatientFlagManager({ patientId, compact }: { patientId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [flags, setFlags] = useState<FlagRow[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<PatientFlagType | null>(null)
  const [notes, setNotes] = useState('')

  async function load() {
    setLoading(true)
    const r = await fetch(`/api/ehr/patients/${patientId}/flags`)
    const j = await r.json(); if (r.ok) setFlags(j.flags ?? [])
    setLoading(false)
  }
  useEffect(() => { if (open) void load() }, [open, patientId])

  async function add(type: PatientFlagType) {
    const r = await fetch(`/api/ehr/patients/${patientId}/flags`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, notes: notes || undefined }),
    })
    if (r.ok) { setAdding(null); setNotes(''); void load() }
  }
  async function clearFlag(id: string) {
    const r = await fetch(`/api/ehr/patients/${patientId}/flags/${id}`, { method: 'DELETE' })
    if (r.ok) void load()
  }

  const activeTypes = new Set(flags.map(f => f.type))
  const available = PATIENT_FLAG_TYPES.filter(t => !activeTypes.has(t))

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={compact
          ? 'inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900'
          : 'inline-flex items-center gap-1.5 text-sm border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-md'}>
        <Flag className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} /> Flags
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Patient flags</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>

            <div className="mt-4">
              <h3 className="text-xs uppercase text-gray-500 font-semibold mb-2">Active</h3>
              {loading && <div className="text-sm text-gray-500">Loading…</div>}
              {!loading && flags.length === 0 && <div className="text-sm text-gray-400">No active flags.</div>}
              <ul className="space-y-2">
                {flags.map(f => (
                  <li key={f.id} className="flex items-start justify-between gap-2 border border-gray-200 rounded p-2">
                    <div className="min-w-0">
                      <div className={`inline-block uppercase tracking-wide text-[10px] px-1.5 py-0.5 rounded border ${PATIENT_FLAG_META[f.type].className}`}>
                        {PATIENT_FLAG_META[f.type].label}
                      </div>
                      {f.notes && <div className="text-xs text-gray-600 mt-1">{f.notes}</div>}
                      <div className="text-[10px] text-gray-400 mt-1">Set {new Date(f.set_at).toLocaleString()}</div>
                    </div>
                    <button onClick={() => clearFlag(f.id)} className="text-xs text-red-600 hover:text-red-700">Clear</button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-5">
              <h3 className="text-xs uppercase text-gray-500 font-semibold mb-2">Add a flag</h3>
              {adding && (
                <div className="border border-blue-300 rounded-md p-3 mb-2 bg-blue-50">
                  <div className="text-sm font-medium text-blue-900">{PATIENT_FLAG_META[adding].label}</div>
                  <textarea
                    rows={2} placeholder="Optional notes" value={notes} onChange={e => setNotes(e.target.value)}
                    className="w-full mt-2 border border-blue-200 rounded px-2 py-1 text-sm"
                  />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => add(adding)} className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1 rounded">Apply</button>
                    <button onClick={() => { setAdding(null); setNotes('') }} className="text-sm text-gray-500">Cancel</button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {available.map(t => (
                  <button key={t} onClick={() => setAdding(t)} className={`uppercase tracking-wide text-[10px] px-1.5 py-0.5 rounded border hover:opacity-90 ${PATIENT_FLAG_META[t].className}`}>
                    + {PATIENT_FLAG_META[t].label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

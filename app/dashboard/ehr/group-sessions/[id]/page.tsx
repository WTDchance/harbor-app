// app/dashboard/ehr/group-sessions/[id]/page.tsx
// Group-session detail. Manage participants + attendance + document per patient.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ChevronLeft, Users, UserPlus, FileText } from 'lucide-react'

type Participant = {
  id: string; patient_id: string; attendance: string
  participation_note: string | null; note_id: string | null
  patient: { id: string; first_name: string; last_name: string } | null
}

export default function GroupSessionDetail() {
  const params = useParams()
  const id = params?.id as string
  const [session, setSession] = useState<any>(null)
  const [participants, setParticipants] = useState<Participant[] | null>(null)
  const [allPatients, setAllPatients] = useState<Array<{ id: string; first_name: string; last_name: string }>>([])
  const [adding, setAdding] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<string>('')

  async function load() {
    const r = await fetch(`/api/ehr/group-sessions/${id}`)
    if (r.ok) {
      const j = await r.json()
      setSession(j.session); setParticipants(j.participants || [])
    }
  }
  async function loadAllPatients() {
    const pr = await fetch('/api/practice/me')
    if (!pr.ok) return
    const p = await pr.json()
    const r = await fetch(`/api/admin/patients?practice_id=${p.practice?.id}`)
    if (r.ok) setAllPatients((await r.json()).patients || [])
  }
  useEffect(() => { load(); loadAllPatients() /* eslint-disable-line */ }, [id])

  async function addPatient() {
    if (!selectedPatient) return
    const r = await fetch(`/api/ehr/group-sessions/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient_id: selectedPatient }),
    })
    if (r.ok) { setAdding(false); setSelectedPatient(''); await load() }
  }

  async function setAttendance(patient_id: string, attendance: string) {
    await fetch(`/api/ehr/group-sessions/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient_id, attendance }),
    })
    await load()
  }

  if (!session) return <div className="p-8 text-sm text-gray-500">Loading…</div>

  const addedIds = new Set((participants ?? []).map((p) => p.patient_id))
  const eligible = allPatients.filter((p) => !addedIds.has(p.id))

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Link href="/dashboard/ehr/group-sessions" className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 mb-4">
        <ChevronLeft className="w-4 h-4" />
        Back
      </Link>
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-teal-600" />
            {session.title}
          </h1>
          <div className="text-xs text-gray-500 mt-1">
            {session.group_type && <>{session.group_type} · </>}
            {session.scheduled_at ? new Date(session.scheduled_at).toLocaleString() : 'No time scheduled'}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">
            Participants ({participants?.length ?? 0})
          </h2>
          {!adding && eligible.length > 0 && (
            <button onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 text-xs bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-md">
              <UserPlus className="w-3.5 h-3.5" />
              Add patient
            </button>
          )}
        </div>

        {adding && (
          <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center gap-2">
            <select value={selectedPatient} onChange={(e) => setSelectedPatient(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="">Select a patient…</option>
              {eligible.map((p) => (
                <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
              ))}
            </select>
            <button onClick={addPatient} disabled={!selectedPatient}
              className="text-xs bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50">
              Add
            </button>
            <button onClick={() => { setAdding(false); setSelectedPatient('') }} className="text-xs text-gray-600">Cancel</button>
          </div>
        )}

        {!participants || participants.length === 0 ? (
          <p className="text-sm text-gray-500">No participants yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {participants.map((p) => (
              <li key={p.id} className="py-2 flex items-center gap-3">
                <div className="flex-1">
                  <Link href={`/dashboard/patients/${p.patient_id}`} className="text-sm font-medium text-teal-700 hover:text-teal-900">
                    {p.patient ? `${p.patient.first_name} ${p.patient.last_name}` : 'Patient'}
                  </Link>
                  {p.participation_note && <div className="text-xs text-gray-500">{p.participation_note}</div>}
                </div>
                <select value={p.attendance} onChange={(e) => setAttendance(p.patient_id, e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs">
                  <option value="attended">Attended</option>
                  <option value="absent">Absent</option>
                  <option value="late">Late</option>
                  <option value="left_early">Left early</option>
                </select>
                <Link
                  href={`/dashboard/ehr/notes/new?patient_id=${p.patient_id}&template=individual_followup`}
                  className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900"
                >
                  <FileText className="w-3 h-3" />
                  Document
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

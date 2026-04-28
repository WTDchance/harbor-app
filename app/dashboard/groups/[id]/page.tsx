// app/dashboard/groups/[id]/page.tsx
//
// W46 T2 — group session detail. Attendance grid + per-member note
// tabs + group treatment plan section.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

type Participant = {
  id: string
  patient_id: string
  attendance: 'attended' | 'absent' | 'late' | 'left_early'
  late_arrival_minutes: number | null
  early_departure_minutes: number | null
  participation_note: string | null
  first_name: string | null
  last_name: string | null
}

type MemberNote = {
  id: string
  patient_id: string
  individual_note_section: string | null
  first_name: string | null
  last_name: string | null
}

type TreatmentPlan = {
  id: string
  title: string
  presenting_problem: string | null
  goals: any[]
  frequency: string | null
  status: string
  start_date: string | null
} | null

const ATTENDANCE_OPTIONS = [
  { value: 'attended',   label: 'Attended' },
  { value: 'late',       label: 'Late' },
  { value: 'left_early', label: 'Left early' },
  { value: 'absent',     label: 'Absent' },
]

export default function GroupSessionPage() {
  const params = useParams<{ id: string }>()
  const sessionId = params?.id as string
  const [tab, setTab] = useState<'attendance' | 'notes' | 'plan'>('attendance')

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Group session</h1>
      <div className="flex gap-2 border-b">
        <TabBtn current={tab} value="attendance" onClick={setTab}>Attendance</TabBtn>
        <TabBtn current={tab} value="notes"      onClick={setTab}>Member notes</TabBtn>
        <TabBtn current={tab} value="plan"       onClick={setTab}>Group plan</TabBtn>
      </div>
      {tab === 'attendance' && <AttendanceTab sessionId={sessionId} />}
      {tab === 'notes'      && <MemberNotesTab sessionId={sessionId} />}
      {tab === 'plan'       && <PlanTab sessionId={sessionId} />}
    </div>
  )
}

function TabBtn({ current, value, onClick, children }: any) {
  const on = current === value
  return (
    <button onClick={() => onClick(value)}
            className={`px-3 py-2 text-sm font-medium ${on ? 'border-b-2 border-[#1f375d] text-[#1f375d]' : 'text-gray-600'}`}>
      {children}
    </button>
  )
}

// ---- Attendance ----
function AttendanceTab({ sessionId }: { sessionId: string }) {
  const [rows, setRows] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/ehr/group-sessions/${sessionId}/attendance`)
      if (!res.ok) return
      const j = await res.json()
      setRows(j.participants || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [sessionId])

  function update(i: number, patch: Partial<Participant>) {
    setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

  async function save() {
    setSaving(true)
    try {
      const entries = rows.map((r) => ({
        patient_id: r.patient_id,
        attendance: r.attendance,
        late_arrival_minutes:    r.attendance === 'late'       ? r.late_arrival_minutes ?? null   : null,
        early_departure_minutes: r.attendance === 'left_early' ? r.early_departure_minutes ?? null : null,
        participation_note: r.participation_note || null,
      }))
      await fetch(`/api/ehr/group-sessions/${sessionId}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      setSavedNote('Saved.')
      setTimeout(() => setSavedNote(null), 2500)
      await load()
    } finally { setSaving(false) }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>
  if (rows.length === 0) return <p className="text-sm text-gray-500">No participants yet.</p>

  return (
    <div className="space-y-3">
      {savedNote && <div className="rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">{savedNote}</div>}
      <div className="bg-white border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="text-left px-3 py-2">Member</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Late (min)</th>
              <th className="text-left px-3 py-2">Left early (min)</th>
              <th className="text-left px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">{(r.first_name || '') + ' ' + (r.last_name || '')}</td>
                <td className="px-3 py-2">
                  <select value={r.attendance}
                          onChange={(e) => update(i, { attendance: e.target.value as any })}
                          className="border rounded px-2 py-1 text-sm">
                    {ATTENDANCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input type="number" min={0} max={120}
                         disabled={r.attendance !== 'late'}
                         value={r.late_arrival_minutes ?? ''}
                         onChange={(e) => update(i, { late_arrival_minutes: e.target.value ? Number(e.target.value) : null })}
                         className="border rounded px-2 py-1 text-sm w-20 disabled:bg-gray-100" />
                </td>
                <td className="px-3 py-2">
                  <input type="number" min={0} max={120}
                         disabled={r.attendance !== 'left_early'}
                         value={r.early_departure_minutes ?? ''}
                         onChange={(e) => update(i, { early_departure_minutes: e.target.value ? Number(e.target.value) : null })}
                         className="border rounded px-2 py-1 text-sm w-20 disabled:bg-gray-100" />
                </td>
                <td className="px-3 py-2">
                  <input type="text"
                         value={r.participation_note || ''}
                         onChange={(e) => update(i, { participation_note: e.target.value })}
                         className="border rounded px-2 py-1 text-sm w-full" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={save} disabled={saving}
              className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
        {saving ? 'Saving…' : 'Save attendance'}
      </button>
    </div>
  )
}

// ---- Member notes ----
function MemberNotesTab({ sessionId }: { sessionId: string }) {
  const [members, setMembers] = useState<MemberNote[]>([])
  const [activePid, setActivePid] = useState<string | null>(null)
  const [section, setSection] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const res = await fetch(`/api/ehr/group-sessions/${sessionId}/member-notes`)
    if (!res.ok) return
    const j = await res.json()
    setMembers(j.members || [])
    if (!activePid && j.members?.[0]) {
      setActivePid(j.members[0].patient_id)
      setSection(j.members[0].individual_note_section || '')
    }
  }
  useEffect(() => { void load() }, [sessionId])

  // Also pull attendees so we can offer notes for members who don't yet have one.
  const [attendees, setAttendees] = useState<Participant[]>([])
  useEffect(() => {
    void (async () => {
      const r = await fetch(`/api/ehr/group-sessions/${sessionId}/attendance`)
      const j = await r.json()
      setAttendees(j.participants || [])
    })()
  }, [sessionId])

  const memberByPid = useMemo(() => {
    const map = new Map<string, MemberNote>()
    for (const m of members) map.set(m.patient_id, m)
    return map
  }, [members])

  async function save() {
    if (!activePid) return
    setSaving(true)
    try {
      await fetch(`/api/ehr/group-sessions/${sessionId}/member-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: activePid, individual_note_section: section }),
      })
      await load()
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 text-xs">
        {attendees.map((a) => {
          const has = memberByPid.has(a.patient_id)
          const on = activePid === a.patient_id
          const label = `${a.first_name || ''} ${a.last_name || ''}`.trim() || '—'
          return (
            <button key={a.id}
                    onClick={() => {
                      setActivePid(a.patient_id)
                      setSection(memberByPid.get(a.patient_id)?.individual_note_section || '')
                    }}
                    className={`px-2 py-1 rounded-full border ${on ? 'bg-[#1f375d] text-white border-[#1f375d]' : 'bg-white text-gray-700 border-gray-300'}`}>
              {label}{has && <span className="ml-1 text-[10px]">✓</span>}
            </button>
          )
        })}
      </div>

      {activePid && (
        <div className="space-y-2">
          <textarea value={section} onChange={(e) => setSection(e.target.value)}
                    rows={8}
                    placeholder="Individual observation for this member (kept on the chart, not on the shared note body)."
                    className="block w-full border rounded px-2 py-2 text-sm" />
          <button onClick={save} disabled={saving}
                  className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save member note'}
          </button>
        </div>
      )}
    </div>
  )
}

// ---- Group treatment plan ----
function PlanTab({ sessionId }: { sessionId: string }) {
  const [plan, setPlan] = useState<TreatmentPlan>(null)
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('Group treatment plan')
  const [presentingProblem, setPresentingProblem] = useState('')
  const [frequency, setFrequency] = useState('')
  const [goalsText, setGoalsText] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/ehr/group-sessions/${sessionId}/treatment-plan`)
      if (!res.ok) return
      const j = await res.json()
      setPlan(j.plan)
      if (j.plan) {
        setTitle(j.plan.title || 'Group treatment plan')
        setPresentingProblem(j.plan.presenting_problem || '')
        setFrequency(j.plan.frequency || '')
        setGoalsText((j.plan.goals || []).map((g: any) => g.text || '').join('\n'))
      }
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [sessionId])

  async function save() {
    setSaving(true)
    try {
      const goals = goalsText.split('\n').map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t }))
      const body = { title, presenting_problem: presentingProblem || null, frequency: frequency || null, goals }
      const path = `/api/ehr/group-sessions/${sessionId}/treatment-plan`
      const method = plan ? 'PATCH' : 'POST'
      const payload = plan ? { plan_id: plan.id, ...body } : body
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) await load()
    } finally { setSaving(false) }
  }

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>

  return (
    <div className="space-y-3 max-w-2xl">
      <label className="block text-sm">
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)}
               className="block w-full border rounded px-2 py-1 mt-1" />
      </label>
      <label className="block text-sm">
        Presenting problem (group-level)
        <textarea value={presentingProblem} onChange={(e) => setPresentingProblem(e.target.value)}
                  rows={3}
                  className="block w-full border rounded px-2 py-1 mt-1" />
      </label>
      <label className="block text-sm">
        Frequency
        <input value={frequency} onChange={(e) => setFrequency(e.target.value)}
               placeholder="Weekly · 90 min"
               className="block w-full border rounded px-2 py-1 mt-1" />
      </label>
      <label className="block text-sm">
        Goals (one per line)
        <textarea value={goalsText} onChange={(e) => setGoalsText(e.target.value)}
                  rows={5}
                  className="block w-full border rounded px-2 py-1 mt-1" />
      </label>
      <button onClick={save} disabled={saving}
              className="bg-[#1f375d] text-white px-3 py-1.5 rounded text-sm disabled:opacity-50">
        {saving ? 'Saving…' : (plan ? 'Update plan' : 'Create plan')}
      </button>
    </div>
  )
}

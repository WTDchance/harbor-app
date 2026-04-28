// components/tasks/ClinicalTasksList.tsx
//
// W46 T3 — shared list+create UI used by the per-patient Tasks tab
// and the Today widget. Pass `patientId` to scope to a single chart.

'use client'

import { useEffect, useState } from 'react'

type Task = {
  id: string
  assigned_to_user_id: string
  patient_id: string | null
  title: string
  description: string | null
  due_at: string | null
  completed_at: string | null
  kind: string
  priority: 'low' | 'normal' | 'high'
  created_at: string
  patient_first_name?: string | null
  patient_last_name?: string | null
  assignee_email?: string | null
}

const PRIORITIES = [
  { value: 'low',    label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high',   label: 'High' },
]
const KINDS = [
  { value: 'patient_reminder',  label: 'Patient reminder' },
  { value: 'clinical_followup', label: 'Clinical follow-up' },
  { value: 'admin',             label: 'Admin' },
  { value: 'supervision',       label: 'Supervision' },
  { value: 'billing',           label: 'Billing' },
]

interface Props {
  patientId?: string
  /** Today widget hides the create form to keep the surface compact. */
  showCreate?: boolean
  /** Today widget reads a tighter window. */
  dueWithin?: '24h' | '7d' | 'all'
  /** Limit visible rows. */
  maxItems?: number
  /** Title shown above the list ('' to suppress). */
  title?: string
}

export default function ClinicalTasksList({
  patientId, showCreate = true, dueWithin = '7d', maxItems, title,
}: Props) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create form state.
  const [titleInput, setTitleInput] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [priority, setPriority] = useState<'low'|'normal'|'high'>('normal')
  const [kind, setKind] = useState('clinical_followup')
  const [creating, setCreating] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (patientId) sp.set('patient_id', patientId)
      if (!patientId) sp.set('due_within', dueWithin)
      const res = await fetch(`/api/ehr/clinical-tasks?${sp.toString()}`)
      if (!res.ok) throw new Error('Failed to load')
      const j = await res.json()
      setTasks((j.tasks || []).slice(0, maxItems ?? 200))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [patientId, dueWithin, maxItems])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!titleInput.trim()) return
    setCreating(true)
    setError(null)
    try {
      const body = {
        title: titleInput.trim(),
        description: description || undefined,
        due_at: dueAt || undefined,
        priority, kind,
        patient_id: patientId,
      }
      const res = await fetch('/api/ehr/clinical-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Create failed')
      }
      setTitleInput(''); setDescription(''); setDueAt(''); setPriority('normal'); setKind('clinical_followup')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  async function complete(id: string) {
    await fetch(`/api/ehr/clinical-tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: true }),
    })
    await load()
  }

  async function reschedule(id: string, days: number) {
    const due = new Date(Date.now() + days * 86_400_000).toISOString()
    await fetch(`/api/ehr/clinical-tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_at: due }),
    })
    await load()
  }

  async function remove(id: string) {
    if (!confirm('Remove this task?')) return
    await fetch(`/api/ehr/clinical-tasks/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div className="space-y-3">
      {title && (
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide px-1">
          {title}
        </h2>
      )}

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {showCreate && (
        <form onSubmit={create} className="rounded border bg-white p-3 space-y-2">
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder={patientId ? 'Add a task for this patient…' : 'Add a task…'}
            className="block w-full border rounded px-2 py-1 text-sm"
            required
          />
          {titleInput && (
            <>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes (optional)"
                className="block w-full border rounded px-2 py-1 text-xs"
                rows={2}
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="border rounded px-2 py-1 text-xs"
                />
                <select value={priority} onChange={(e) => setPriority(e.target.value as any)}
                        className="border rounded px-2 py-1 text-xs">
                  {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <select value={kind} onChange={(e) => setKind(e.target.value)}
                        className="border rounded px-2 py-1 text-xs">
                  {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </div>
              <button
                type="submit"
                disabled={creating}
                className="bg-[#1f375d] text-white px-3 py-1 rounded text-sm disabled:opacity-50"
              >
                {creating ? 'Adding…' : 'Add task'}
              </button>
            </>
          )}
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-gray-500">
          {patientId ? 'No tasks for this patient.' : 'Nothing on your task list right now.'}
        </p>
      ) : (
        <ul className="border rounded divide-y bg-white">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              showPatientLink={!patientId}
              onComplete={() => complete(t.id)}
              onReschedule={(d) => reschedule(t.id, d)}
              onRemove={() => remove(t.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function TaskRow({
  task: t, showPatientLink, onComplete, onReschedule, onRemove,
}: {
  task: Task
  showPatientLink: boolean
  onComplete: () => void
  onReschedule: (days: number) => void
  onRemove: () => void
}) {
  const overdue = t.due_at && !t.completed_at && new Date(t.due_at).getTime() < Date.now()
  const priorityTone = t.priority === 'high'
    ? 'border-l-red-500'
    : t.priority === 'low'
      ? 'border-l-gray-300'
      : 'border-l-blue-400'

  return (
    <li className={`px-3 py-2 border-l-2 ${priorityTone}`}>
      <div className="flex items-start gap-2">
        <button
          onClick={onComplete}
          className="mt-0.5 h-4 w-4 border rounded hover:bg-green-50 flex-shrink-0"
          aria-label="Mark complete"
          title="Mark complete"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{t.title}</div>
          {t.description && (
            <div className="text-xs text-gray-600 mt-0.5">{t.description}</div>
          )}
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
            {t.due_at && (
              <span className={overdue ? 'text-red-600 font-medium' : ''}>
                {overdue ? 'Overdue · ' : 'Due '}
                {new Date(t.due_at).toLocaleDateString(undefined, {
                  month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                })}
              </span>
            )}
            {showPatientLink && t.patient_first_name && (
              <span>· {t.patient_first_name} {t.patient_last_name}</span>
            )}
            <span>· {t.kind.replace(/_/g, ' ')}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          <button onClick={() => onReschedule(1)} className="text-gray-500 hover:underline">+1d</button>
          <button onClick={() => onReschedule(7)} className="text-gray-500 hover:underline">+1w</button>
          <button onClick={onRemove} className="text-red-600 hover:underline">×</button>
        </div>
      </div>
    </li>
  )
}

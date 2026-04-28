// components/bulk-actions/PatientBulkToolbar.tsx
//
// W47 T5 — actions toolbar for selected patients on the patient list.
// Caller provides the selected ids + a clearSelection callback.

'use client'

import { useState } from 'react'

type Action = 'send_message' | 'reassign_therapist' | 'discharge' | 'add_flag' | 'send_form'

interface Props {
  selectedIds: string[]
  onClear: () => void
  onSuccess?: () => void
  /** Show admin-only actions. Caller decides — most pages render the
   *  toolbar with isAdmin=false and admin pages flip to true. */
  isAdmin?: boolean
  /** Optional pre-loaded list of forms (W47 T2). */
  forms?: Array<{ id: string; name: string }>
  /** Optional pre-loaded list of therapists for reassign. */
  therapists?: Array<{ id: string; label: string }>
}

export default function PatientBulkToolbar({
  selectedIds, onClear, onSuccess, isAdmin, forms, therapists,
}: Props) {
  const [action, setAction] = useState<Action | ''>('')
  const [body, setBody] = useState('')
  const [therapistId, setTherapistId] = useState('')
  const [reason, setReason] = useState('')
  const [flagContent, setFlagContent] = useState('')
  const [flagColor, setFlagColor] = useState<'blue'|'green'|'yellow'|'red'>('blue')
  const [formId, setFormId] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (!action) return
    setRunning(true); setError(null); setResult(null)
    try {
      const payload: Record<string, unknown> = { action, patient_ids: selectedIds }
      if (action === 'send_message') payload.body = body
      if (action === 'reassign_therapist') payload.therapist_id = therapistId
      if (action === 'discharge') payload.reason = reason
      if (action === 'add_flag') { payload.content = flagContent; payload.color = flagColor }
      if (action === 'send_form') payload.form_id = formId

      if (!confirm(`Apply "${action.replace(/_/g, ' ')}" to ${selectedIds.length} patient(s)?`)) {
        setRunning(false); return
      }

      const res = await fetch('/api/ehr/patients/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Bulk action failed')
      setResult(`✓ ${j.succeeded} of ${j.attempted} succeeded${j.failed ? ` · ${j.failed} failed` : ''}`)
      onSuccess?.()
    } catch (e) {
      setError((e as Error).message)
    } finally { setRunning(false) }
  }

  if (selectedIds.length === 0) return null

  return (
    <div className="rounded border bg-white p-3 space-y-2 sticky bottom-2 shadow">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{selectedIds.length} selected</span>
        <button onClick={onClear} className="text-xs text-gray-500 hover:underline">Clear</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={action} onChange={(e) => setAction(e.target.value as Action)}
                className="border rounded px-2 py-1 text-sm">
          <option value="">Pick an action…</option>
          <option value="send_message">Send message</option>
          <option value="add_flag">Add flag</option>
          <option value="send_form">Send form</option>
          {isAdmin && <option value="reassign_therapist">Reassign therapist</option>}
          {isAdmin && <option value="discharge">Discharge</option>}
        </select>

        {action === 'send_message' && (
          <input value={body} onChange={(e) => setBody(e.target.value)}
                 placeholder="Message body"
                 maxLength={1500}
                 className="border rounded px-2 py-1 text-sm flex-1 min-w-48" />
        )}
        {action === 'reassign_therapist' && (
          <select value={therapistId} onChange={(e) => setTherapistId(e.target.value)}
                  className="border rounded px-2 py-1 text-sm">
            <option value="">— Therapist —</option>
            {(therapists || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
        {action === 'discharge' && (
          <input value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder="Reason (optional)"
                 maxLength={200}
                 className="border rounded px-2 py-1 text-sm flex-1 min-w-48" />
        )}
        {action === 'add_flag' && (
          <>
            <input value={flagContent} onChange={(e) => setFlagContent(e.target.value)}
                   placeholder="Flag text"
                   maxLength={200}
                   className="border rounded px-2 py-1 text-sm flex-1 min-w-48" />
            <select value={flagColor} onChange={(e) => setFlagColor(e.target.value as any)}
                    className="border rounded px-2 py-1 text-sm">
              <option value="blue">blue</option>
              <option value="green">green</option>
              <option value="yellow">yellow</option>
              <option value="red">red</option>
            </select>
          </>
        )}
        {action === 'send_form' && (
          <select value={formId} onChange={(e) => setFormId(e.target.value)}
                  className="border rounded px-2 py-1 text-sm">
            <option value="">— Form —</option>
            {(forms || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}

        <button onClick={run} disabled={running || !action}
                className="bg-[#1f375d] text-white px-3 py-1 rounded text-sm disabled:opacity-50">
          {running ? 'Working…' : 'Run'}
        </button>
      </div>

      {result && <p className="text-xs text-green-700">{result}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

// app/dashboard/admin/merge-patients/page.tsx
//
// W44 T4 — admin merge two patient records into one. Pick "keep" and
// "merge" by patient ID; the API reassigns appointments / notes /
// charges / etc. to the keep row and marks the merge row inactive.

'use client'

import { useState } from 'react'

export default function MergePatientsPage() {
  const [keepId, setKeepId] = useState('')
  const [mergeId, setMergeId] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    if (!confirm) {
      setError('Type CONFIRM into the confirmation box first.')
      return
    }
    setWorking(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/ehr/admin/patients/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_id: keepId, merge_id: mergeId }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Failed (${res.status})`)
      setResult(j)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Merge patients</h1>
        <p className="text-sm text-gray-600 mt-1">
          Combine two duplicate patient records into one. The "keep"
          record survives; everything attached to the "merge" record
          (appointments, notes, charges, documents, relationships,
          payments) is reassigned to the keep record. The merge
          record is marked inactive — not deleted — so you can
          recover if a merge was wrong.
        </p>
      </div>

      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        Admin only. This is destructive. Verify both patients are
        actually the same person before proceeding.
      </div>

      <div className="rounded border bg-white p-4 space-y-3">
        <label className="block text-sm">
          Keep patient ID
          <input
            type="text"
            value={keepId}
            onChange={(e) => setKeepId(e.target.value)}
            placeholder="UUID"
            className="block w-full border rounded px-2 py-1 mt-1 font-mono text-xs"
          />
        </label>
        <label className="block text-sm">
          Merge (and remove) patient ID
          <input
            type="text"
            value={mergeId}
            onChange={(e) => setMergeId(e.target.value)}
            placeholder="UUID"
            className="block w-full border rounded px-2 py-1 mt-1 font-mono text-xs"
          />
        </label>
        <label className="block text-sm">
          Type CONFIRM to proceed
          <input
            type="text"
            onChange={(e) => setConfirm(e.target.value === 'CONFIRM')}
            className="block w-full border rounded px-2 py-1 mt-1"
          />
        </label>
        <button
          onClick={go}
          disabled={working || !keepId || !mergeId || !confirm}
          className="bg-red-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {working ? 'Merging…' : 'Merge'}
        </button>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="rounded bg-green-50 border border-green-200 p-3 text-sm space-y-1">
          <div className="font-medium">Merge complete.</div>
          <div className="text-xs">
            Kept: <code>{result.kept}</code><br/>
            Merged: <code>{result.merged}</code>
          </div>
          {result.rows_reassigned && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-gray-700">Rows reassigned</summary>
              <pre className="text-xs mt-1 whitespace-pre-wrap">{JSON.stringify(result.rows_reassigned, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

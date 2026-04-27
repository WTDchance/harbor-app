'use client'

// Wave 40 / P2 — HIPAA Privacy Officer audit log dashboard.
//
// Practice-scoped (per-practice privacy officer access). Filterable by
// patient, actor, action, date range. Cursor-paginated. CSV export
// uses the same filters and redacts known PHI keys in details.

import { useEffect, useState } from 'react'
import { Download, Filter, ChevronRight, AlertCircle } from 'lucide-react'

interface AuditEntry {
  id: string
  timestamp: string
  user_id: string | null
  user_email: string | null
  practice_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  details: any
  severity: 'info' | 'warning' | 'critical'
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Filter state.
  const [patientId, setPatientId] = useState('')
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  function buildQs(extra: Record<string, string | null> = {}): string {
    const params = new URLSearchParams()
    if (patientId) params.set('patient_id', patientId)
    if (actor) params.set('actor', actor)
    if (action) params.set('action', action)
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v); else params.delete(k)
    }
    return params.toString()
  }

  async function load(append = false) {
    setLoading(true)
    setError(null)
    try {
      const cursor = append ? nextCursor : null
      const qs = buildQs(cursor ? { cursor } : {})
      const res = await fetch(`/api/admin/audit-log${qs ? `?${qs}` : ''}`, { credentials: 'include' })
      if (!res.ok) {
        setError(res.status === 403 ? 'You do not have access to this dashboard.' : `Load failed (${res.status})`)
        if (!append) setEntries([])
        return
      }
      const data = await res.json()
      const newEntries = Array.isArray(data?.entries) ? data.entries : []
      setEntries(append ? [...entries, ...newEntries] : newEntries)
      setNextCursor(data?.next_cursor ?? null)
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyFilters() {
    setEntries([])
    setNextCursor(null)
    void load(false)
  }

  function clearFilters() {
    setPatientId(''); setActor(''); setAction(''); setDateFrom(''); setDateTo('')
    setEntries([])
    setNextCursor(null)
    setTimeout(() => void load(false), 0)
  }

  function downloadCsv() {
    const qs = buildQs()
    const url = `/api/admin/audit-log/export${qs ? `?${qs}` : ''}`
    window.location.href = url
  }

  return (
    <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit log</h1>
          <p className="text-sm text-gray-500 mt-0.5">HIPAA Privacy Officer view. Read-only, practice-scoped.</p>
        </div>
        <button
          onClick={downloadCsv}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700"
          style={{ minHeight: 44 }}
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-700">Filters</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Patient ID">
            <input value={patientId} onChange={(e) => setPatientId(e.target.value)}
                   placeholder="UUID" className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
          </Field>
          <Field label="Actor (email or user UUID)">
            <input value={actor} onChange={(e) => setActor(e.target.value)}
                   placeholder="jane@practice.com" className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
          </Field>
          <Field label="Action contains">
            <input value={action} onChange={(e) => setAction(e.target.value)}
                   placeholder="note.view" className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                     className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
            </Field>
            <Field label="To">
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                     className="w-full p-2 text-sm border border-gray-200 rounded-lg" style={{ minHeight: 44 }} />
            </Field>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-4">
          <button onClick={clearFilters}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                  style={{ minHeight: 44 }}>Clear</button>
          <button onClick={applyFilters}
                  className="px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-800"
                  style={{ minHeight: 44 }}>Apply</button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">When</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Actor</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Action</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Resource</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Severity</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((e) => (
                <RowAndDetails
                  key={e.id}
                  e={e}
                  expanded={expandedId === e.id}
                  onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
                />
              ))}
              {entries.length === 0 && !loading && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">No audit events match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-100 p-3 flex items-center justify-between">
          <span className="text-xs text-gray-500">{entries.length} loaded</span>
          {nextCursor ? (
            <button onClick={() => void load(true)} disabled={loading}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-60"
                    style={{ minHeight: 44 }}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          ) : (
            <span className="text-xs text-gray-400">{loading ? 'Loading…' : 'End of results'}</span>
          )}
        </div>
      </div>
    </main>
  )
}

function RowAndDetails({ e, expanded, onToggle }: { e: AuditEntry; expanded: boolean; onToggle: () => void }) {
  const sevClass =
    e.severity === 'critical' ? 'bg-red-100 text-red-800' :
    e.severity === 'warning'  ? 'bg-amber-100 text-amber-800' :
                                'bg-gray-100 text-gray-700'
  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-700">
          {new Date(e.timestamp).toLocaleString()}
        </td>
        <td className="px-4 py-3 text-xs text-gray-700">{e.user_email ?? <code className="text-gray-400">{e.user_id?.slice(0, 8) ?? '—'}</code>}</td>
        <td className="px-4 py-3 text-xs"><code className="bg-gray-50 px-1.5 py-0.5 rounded">{e.action}</code></td>
        <td className="px-4 py-3 text-xs text-gray-600">
          {e.resource_type ? <span>{e.resource_type}</span> : '—'}
          {e.resource_id ? <span className="text-gray-400"> · {e.resource_id.slice(0, 8)}</span> : null}
        </td>
        <td className="px-4 py-3"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${sevClass}`}>{e.severity}</span></td>
        <td className="px-4 py-3 text-right">
          <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50">
          <td colSpan={6} className="px-4 py-3">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words">{JSON.stringify(e.details ?? {}, null, 2)}</pre>
            <p className="text-xs text-amber-700 mt-2">
              ⚠ Details may contain PHI. CSV export sanitizes known PHI keys (patient_name, dob, email, phone, etc.); this in-app view does not.
            </p>
          </td>
        </tr>
      )}
    </>
  )
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

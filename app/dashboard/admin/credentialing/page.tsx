// app/dashboard/admin/credentialing/page.tsx
//
// W49 T4 — admin overview of all practice users' credentialing
// status. Highlights expired and expiring-soon licenses.

'use client'

import { useEffect, useState } from 'react'

type Row = {
  id: string
  email: string
  full_name: string
  role: string
  npi: string | null
  license_type: string | null
  license_number: string | null
  license_state: string | null
  license_expires_at: string | null
  license_status: 'unknown' | 'expired' | 'expiring_soon' | 'ok'
  caqh_id: string | null
  dea_number: string | null
  ce_hours_this_year: number
}

const STATUS_BADGE: Record<Row['license_status'], string> = {
  expired:       'bg-red-100 text-red-800 border-red-200',
  expiring_soon: 'bg-amber-100 text-amber-800 border-amber-200',
  ok:            'bg-green-100 text-green-800 border-green-200',
  unknown:       'bg-gray-100 text-gray-700 border-gray-200',
}

export default function CredentialingOverviewPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [year, setYear] = useState(new Date().getUTCFullYear())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/ehr/admin/credentialing-overview')
        if (res.status === 403) throw new Error('Admin only.')
        if (!res.ok) throw new Error(`Failed (${res.status})`)
        const j = await res.json()
        setYear(j.year)
        setRows(j.users || [])
      } catch (e) {
        setError((e as Error).message)
      } finally { setLoading(false) }
    })()
  }, [])

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Credentialing</h1>
      <p className="text-sm text-gray-600">
        Practice-wide credentials view. Rows highlighted red have expired
        licenses; amber rows expire within 30 days. CE hours are for {year}.
      </p>
      {error && <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="text-left px-3 py-2">User</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-left px-3 py-2">License</th>
              <th className="text-left px-3 py-2">Expires</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">NPI</th>
              <th className="text-right px-3 py-2">CE hrs</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-3 text-gray-500">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-3 text-gray-500">No users.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.full_name || r.email}</div>
                  <div className="text-xs text-gray-500">{r.email}</div>
                </td>
                <td className="px-3 py-2 text-xs">{r.role}</td>
                <td className="px-3 py-2 text-xs">
                  {r.license_type ? (
                    <>{r.license_type}{r.license_state ? ` · ${r.license_state}` : ''}{r.license_number ? ` · ${r.license_number.slice(0, 6)}…` : ''}</>
                  ) : '—'}
                </td>
                <td className="px-3 py-2 text-xs">{r.license_expires_at || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_BADGE[r.license_status]}`}>
                    {r.license_status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.npi || '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.ce_hours_this_year.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// app/dashboard/ehr/referrals/page.tsx — who's sending you patients.
'use client'

import { useEffect, useState } from 'react'
import { Share2 } from 'lucide-react'

type Row = {
  source: string; patients: number; had_first_session: number
  active_patients: number; conversion_rate: number
}

export default function ReferralsPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/ehr/reports/referrals')
      if (r.ok) {
        const j = await r.json()
        setRows(j.rows || [])
        setTotal(j.total_patients || 0)
      }
    })()
  }, [])

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <Share2 className="w-6 h-6 text-teal-600" />
          Referral sources
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Where your patients come from, and what percentage of each source actually books a first session.
        </p>
      </div>

      {rows === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-500">
          No patients yet.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Source</th>
                <th className="text-right px-4 py-2">Inquiries</th>
                <th className="text-right px-4 py-2">First session</th>
                <th className="text-right px-4 py-2">Conversion</th>
                <th className="text-left px-4 py-2">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => {
                const share = total ? (r.patients / total) * 100 : 0
                return (
                  <tr key={r.source} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <span className="font-medium text-gray-900">{r.source}</span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{r.patients}</td>
                    <td className="px-4 py-2 text-right font-mono">{r.had_first_session}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        r.conversion_rate >= 70 ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : r.conversion_rate >= 40 ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-red-50 text-red-800 border-red-200'
                      }`}>{r.conversion_rate}%</span>
                    </td>
                    <td className="px-4 py-2 w-48">
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-teal-500" style={{ width: `${share}%` }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

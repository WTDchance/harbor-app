// app/portal/hsa-receipts/page.tsx
//
// W43 T5 — patient portal: download an HSA/FSA payment receipt for
// any tax year. Generates the PDF on demand from ehr_payments.

'use client'

import { useState } from 'react'

const CURRENT_YEAR = new Date().getUTCFullYear()
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3]

export default function HsaReceiptsPage() {
  const [year, setYear] = useState<number>(CURRENT_YEAR)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setLoading(true)
    setError(null)
    try {
      const from = `${year}-01-01`
      const to = `${year}-12-31`
      const res = await fetch(`/api/portal/hsa-receipts?from=${from}&to=${to}`)
      if (!res.ok) {
        if (res.status === 404) {
          setError(
            `No payments found for ${year}. The receipt only includes ` +
            'amounts you paid out of pocket — insurance-paid amounts ' +
            'are not eligible for HSA/FSA reimbursement.',
          )
          return
        }
        throw new Error(`Server error: ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `hsa-receipt-${year}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">HSA / FSA Receipt</h1>
        <p className="text-sm text-gray-600 mt-2">
          Download a receipt of all out-of-pocket payments for a given tax
          year. You can submit it to your HSA or FSA plan administrator
          for reimbursement of qualified medical expenses.
        </p>
      </div>

      <div className="rounded border border-gray-200 bg-white p-4 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Tax year</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="mt-1 block w-40 border rounded px-2 py-1.5"
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>

        <button
          onClick={download}
          disabled={loading}
          className="inline-flex items-center gap-2 bg-[#1f375d] text-white px-4 py-2 rounded font-medium disabled:opacity-50"
        >
          {loading ? 'Generating receipt…' : `Download ${year} receipt`}
        </button>

        {error && (
          <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            {error}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-500 leading-relaxed">
        <p>
          The receipt covers payments made between January 1 and December
          31 of the selected year. It reflects amounts you paid yourself
          (card, check, cash, or external card terminal) and excludes any
          insurance reimbursements. IRS Publication 502 lists psychotherapy
          as a qualified medical expense.
        </p>
      </div>
    </div>
  )
}

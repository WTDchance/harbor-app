'use client'

// Wave 40 / P5 — patient-portal per-superbill download page.
//
// Shows date range + total + a Download button. The button hits
// /api/portal/superbills/[id] which streams the PDF directly.
// Auth-fail bounces the user to /portal/login.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ChevronLeft, Download, FileText } from 'lucide-react'

interface Superbill {
  id: string
  from_date: string
  to_date: string
  total_cents: number
  generated_at: string
}

export default function PortalSuperbillDetailPage() {
  const params = useParams()
  const router = useRouter()
  const superbillId = String(params.id)

  const [item, setItem] = useState<Superbill | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      // Find the row in the list endpoint (already auth-gated).
      const res = await fetch('/api/portal/superbills', { credentials: 'include' })
      if (res.status === 401) { router.replace('/portal/login'); return }
      if (!res.ok) { setError('Could not load superbill'); setLoading(false); return }
      const data = await res.json()
      const found = (Array.isArray(data?.superbills) ? data.superbills : []).find((s: Superbill) => s.id === superbillId)
      if (!found) { setError('Superbill not found'); setLoading(false); return }
      setItem(found)
      setLoading(false)
    })()
  }, [router, superbillId])

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link
        href="/portal/superbills"
        className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 mb-4"
        style={{ minHeight: 44 }}
      >
        <ChevronLeft className="w-4 h-4" />
        Back to superbills
      </Link>

      <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2 mb-4">
        <FileText className="w-6 h-6 text-teal-600" />
        Superbill
      </h1>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : error ? (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      ) : item ? (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          <Row label="Date range" value={`${new Date(item.from_date).toLocaleDateString()} — ${new Date(item.to_date).toLocaleDateString()}`} />
          <Row label="Total billed" value={`$${(item.total_cents / 100).toFixed(2)}`} />
          <Row label="Issued" value={new Date(item.generated_at).toLocaleDateString()} />

          <div className="pt-3">
            <a
              href={`/api/portal/superbills/${item.id}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700"
              style={{ minHeight: 44 }}
            >
              <Download className="w-4 h-4" />
              Download PDF
            </a>
          </div>

          <p className="text-xs text-gray-500 pt-3">
            Submit this PDF to your insurance company for out-of-network reimbursement, or attach it to an HSA/FSA claim.
            Need a different date range? Ask your therapist to generate one.
          </p>
        </div>
      ) : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  )
}

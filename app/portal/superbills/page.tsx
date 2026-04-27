// app/portal/superbills/page.tsx — patient sees superbills issued to them.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, FileText, Download } from 'lucide-react'

type Superbill = { id: string; from_date: string; to_date: string; total_cents: number; generated_at: string }

export default function PortalSuperbillsPage() {
  const router = useRouter()
  const [items, setItems] = useState<Superbill[] | null>(null)

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/portal/superbills')
      if (res.status === 401) { router.replace('/portal/login'); return }
      const json = await res.json()
      setItems(json.superbills || [])
    })()
  }, [router])

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/portal/home" className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 mb-4">
        <ChevronLeft className="w-4 h-4" />
        Back to portal
      </Link>
      <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2 mb-2">
        <FileText className="w-6 h-6 text-teal-600" />
        Superbills
      </h1>
      <p className="text-sm text-gray-500 mb-4">
        Itemized receipts you can submit to your insurance for out-of-network reimbursement.
      </p>

      <GenerateSuperbillBox />

      {items === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">
          No superbills on file. Ask your therapist to generate one for a date range if you need it.
        </p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {items.map((s) => (
            <div key={s.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {new Date(s.from_date).toLocaleDateString()} — {new Date(s.to_date).toLocaleDateString()}
                </div>
                <div className="text-xs text-gray-500">
                  Issued {new Date(s.generated_at).toLocaleDateString()} · ${(s.total_cents / 100).toFixed(2)}
                </div>
              </div>
              <a
                href={`/api/ehr/billing/superbill?patient_id=self&from=${s.from_date}&to=${s.to_date}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-teal-700 hover:text-teal-900 font-medium"
              >
                <Download className="w-4 h-4" />
                Open
              </a>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        Tip: print or save these as PDF from your browser, then upload to your insurance company&apos;s website or app.
      </p>
    </div>
  )
}

function GenerateSuperbillBox() {
  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = today.slice(0, 8) + '01'
  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(today)
  return (
    <div className="bg-white border border-teal-200 rounded-xl p-4 mb-6">
      <div className="text-sm font-medium text-gray-900 mb-2">Generate a new superbill</div>
      <p className="text-xs text-gray-500 mb-3">Pick a date range — we&apos;ll produce a PDF you can save or email to your insurer.</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <a
          href={`/api/portal/superbill/pdf?from=${from}&to=${to}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg"
        >
          <Download className="w-4 h-4" />
          Generate PDF
        </a>
      </div>
    </div>
  )
}

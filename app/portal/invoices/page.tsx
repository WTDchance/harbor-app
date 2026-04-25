// app/portal/invoices/page.tsx — patient's invoices with pay links.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, DollarSign, ExternalLink, CheckCircle2 } from 'lucide-react'

type Invoice = {
  id: string
  total_cents: number
  paid_cents: number
  status: string
  stripe_payment_url: string | null
  sent_at: string | null
  paid_at: string | null
  due_date: string | null
  created_at: string
}

function cents(n: number): string { return `$${(n / 100).toFixed(2)}` }

export default function PortalInvoicesPage() {
  const router = useRouter()
  const [items, setItems] = useState<Invoice[] | null>(null)

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/portal/invoices')
      if (res.status === 401) { router.replace('/portal/login'); return }
      const json = await res.json()
      setItems(json.invoices || [])
    })()
  }, [router])

  const unpaid = (items ?? []).filter((i) => i.status === 'sent' || i.status === 'partial')
  const paid = (items ?? []).filter((i) => i.status === 'paid')

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/portal/home" className="inline-flex items-center gap-1 text-sm text-teal-700 hover:text-teal-900 mb-4">
        <ChevronLeft className="w-4 h-4" />
        Back to portal
      </Link>
      <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2 mb-4">
        <DollarSign className="w-6 h-6 text-teal-600" />
        Invoices
      </h1>

      {items === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">No invoices on file.</p>
      ) : (
        <>
          {unpaid.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Due</h2>
              <div className="space-y-2">
                {unpaid.map((i) => (
                  <div key={i.id} className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div className="flex items-center justify-between gap-4 mb-2">
                      <div>
                        <div className="text-xl font-bold text-amber-900 font-mono">{cents(i.total_cents - i.paid_cents)}</div>
                        <div className="text-xs text-amber-800">
                          {i.due_date ? `Due ${new Date(i.due_date).toLocaleDateString()}` : 'Due soon'}
                          {i.sent_at && ` · Sent ${new Date(i.sent_at).toLocaleDateString()}`}
                        </div>
                      </div>
                      {i.stripe_payment_url && (
                        <a
                          href={i.stripe_payment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-medium"
                        >
                          Pay now
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {paid.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Paid</h2>
              <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                {paid.map((i) => (
                  <div key={i.id} className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-sm text-gray-900 font-mono">{cents(i.paid_cents)}</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      Paid {i.paid_at ? new Date(i.paid_at).toLocaleDateString() : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// app/dashboard/billing/invoices/InvoiceRowSubmitButton.tsx
//
// Tiny client component used in the invoice list. Posts to
// /api/ehr/billing/invoices/[id]/submit-claim then refreshes the page
// so the row re-renders with the new submission status. No body — the
// initial Stedi submission takes no client-side input (per the W41 T5
// route which auto-resolves payer + builds the X12 from invoice data).

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SendHorizonal, Loader2 } from 'lucide-react'

export function InvoiceRowSubmitButton({
  invoiceId,
  fullWidth = false,
}: {
  invoiceId: string
  fullWidth?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const sizeClass = fullWidth ? 'w-full' : 'min-w-[44px]'

  const onClick = async () => {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/ehr/billing/invoices/${invoiceId}/submit-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        const msg = json?.error?.message ?? json?.error ?? `Submit failed (${res.status})`
        throw new Error(typeof msg === 'string' ? msg : 'Submit failed')
      }
      startTransition(() => router.refresh())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={`inline-flex flex-col gap-1 ${fullWidth ? 'w-full' : ''}`}>
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        className={`inline-flex items-center justify-center gap-1 h-11 ${sizeClass} px-3 rounded-md bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-xs font-medium`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizonal className="w-4 h-4" />}
        Submit
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </span>
  )
}

// app/dashboard/billing/invoices/[id]/InvoiceActions.tsx
//
// Wave 43 — Action panel for the invoice detail page. Wraps the W41 T5
// patch's POST endpoints:
//   - /api/ehr/billing/invoices/[id]/submit-claim   (no body)
//   - /api/ehr/billing/invoices/[id]/resubmit-claim ({ corrections, reason })
//   - /api/ehr/billing/invoices/[id]/cancel-claim   ({ reason })
//
// Plus a "Generate superbill" link that points at the W38 superbill route
// for cash-pay invoices.
//
// Buttons stack vertically on narrow screens. All tap targets >=44px.
// On open of resubmit/cancel via deep-link (?action=...), the relevant
// form/modal opens automatically — wired through useEffect on mount.

'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  SendHorizonal, RotateCcw, XOctagon, Receipt, Loader2, X,
} from 'lucide-react'
import { CorrectionsForm, type CorrectionDefaults } from './CorrectionsForm'

type ActionMode = null | 'resubmit' | 'cancel'

export function InvoiceActions({
  invoiceId,
  canSubmit,
  canResubmit,
  canCancel,
  isCashPay,
  superbillUrl,
  autoOpenAction,
  rejectionReasons,
  defaultCorrections,
}: {
  invoiceId: string
  canSubmit: boolean
  canResubmit: boolean
  canCancel: boolean
  isCashPay: boolean
  superbillUrl: string | null
  autoOpenAction: 'resubmit' | 'cancel' | null
  rejectionReasons: string
  defaultCorrections: CorrectionDefaults
}) {
  const router = useRouter()
  const [open, setOpen] = useState<ActionMode>(autoOpenAction)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // If the caller deep-links straight to ?action=resubmit but conditions
  // changed by the time the page rendered, autoOpenAction is null. We
  // honour the prop on mount only — subsequent re-renders (e.g. after
  // router.refresh) shouldn't re-pop modals.
  useEffect(() => {
    if (autoOpenAction) setOpen(autoOpenAction)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- handlers ----------------------------------------------------

  const onSubmitClaim = async () => {
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
        const issues = Array.isArray(json?.issues) && json.issues.length > 0
          ? `\n\n• ${json.issues.map((i: any) => i.message ?? JSON.stringify(i)).join('\n• ')}`
          : ''
        throw new Error(`${typeof msg === 'string' ? msg : 'Submit failed'}${issues}`)
      }
      startTransition(() => router.refresh())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onResubmit = async (payload: { corrections: Record<string, unknown>; reason: string }) => {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/ehr/billing/invoices/${invoiceId}/resubmit-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        const msg = json?.error?.message ?? json?.error ?? `Resubmit failed (${res.status})`
        throw new Error(typeof msg === 'string' ? msg : 'Resubmit failed')
      }
      setOpen(null)
      startTransition(() => router.refresh())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onCancel = async (reason: string) => {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/ehr/billing/invoices/${invoiceId}/cancel-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        const msg = json?.error?.message ?? json?.error ?? `Cancel failed (${res.status})`
        throw new Error(typeof msg === 'string' ? msg : 'Cancel failed')
      }
      setOpen(null)
      startTransition(() => router.refresh())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ----- render ------------------------------------------------------

  const showAnyAction = canSubmit || canResubmit || canCancel || (isCashPay && !!superbillUrl)
  if (!showAnyAction) return null

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
      <div className="flex flex-col sm:flex-row gap-2">
        {canSubmit && (
          <button
            type="button"
            disabled={busy}
            onClick={onSubmitClaim}
            className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-md bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm font-medium"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizonal className="w-4 h-4" />}
            Submit claim
          </button>
        )}
        {canResubmit && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen('resubmit')}
            className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-md bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white text-sm font-medium"
          >
            <RotateCcw className="w-4 h-4" />
            Fix and resubmit
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen('cancel')}
            className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-md bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium"
          >
            <XOctagon className="w-4 h-4" />
            Cancel claim with payer
          </button>
        )}
        {isCashPay && superbillUrl && (
          <a
            href={superbillUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-md bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 text-sm font-medium"
          >
            <Receipt className="w-4 h-4" />
            Generate superbill
          </a>
        )}
      </div>
      {error && (
        <div className="mt-3 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800 whitespace-pre-line">
          {error}
        </div>
      )}

      {/* Resubmit corrections form modal */}
      {open === 'resubmit' && (
        <Modal title="Fix and resubmit claim" onClose={() => setOpen(null)}>
          <CorrectionsForm
            defaults={defaultCorrections}
            rejectionReasons={rejectionReasons}
            busy={busy}
            onCancel={() => setOpen(null)}
            onSubmit={onResubmit}
          />
        </Modal>
      )}

      {/* Cancel confirmation modal */}
      {open === 'cancel' && (
        <Modal title="Cancel claim with payer (CFC=8)" onClose={() => setOpen(null)}>
          <CancelConfirm busy={busy} onCancel={() => setOpen(null)} onConfirm={onCancel} />
        </Modal>
      )}
    </div>
  )
}

// ----- modal shell -----------------------------------------------------

function Modal({
  title, onClose, children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  // Lock background scroll while modal is open. Cleans up on unmount.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl border border-gray-200 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-11 -mr-2 inline-flex items-center justify-center text-gray-500 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

// ----- cancel confirmation --------------------------------------------

function CancelConfirm({
  busy, onCancel, onConfirm,
}: {
  busy: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="space-y-3">
      <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
        <strong>This is the formal void with the payer.</strong> Stedi will send
        an 837P with claim frequency code <span className="font-mono">8</span>{' '}
        referencing the existing PCCN. A new <span className="font-mono">ehr_claim_submissions</span>{' '}
        row is created with <span className="font-mono">is_cancellation=true</span>.
        Medicare does not accept CFC=8 — use a corrected resubmission instead
        when applicable.
      </div>
      <label className="flex flex-col gap-1 text-xs text-gray-600">
        Reason (kept on the audit log)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. duplicate claim — superseded by appointment 12345"
          className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm bg-white"
        />
      </label>
      <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-11 px-4 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Keep claim
        </button>
        <button
          type="button"
          onClick={() => onConfirm(reason.trim())}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-md bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <XOctagon className="w-4 h-4" />}
          Confirm cancellation
        </button>
      </div>
    </div>
  )
}

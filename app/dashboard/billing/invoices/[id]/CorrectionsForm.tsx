// app/dashboard/billing/invoices/[id]/CorrectionsForm.tsx
//
// Wave 43 — corrections form for "Fix and resubmit". Pre-fills with the
// invoice's current claimInformation fields and the 277CA rejection
// reasons (read-only). On submit POSTs to
// /api/ehr/billing/invoices/[id]/resubmit-claim with body
// { corrections, reason }. The server picks CFC=1 (Medicare or pre-adj)
// or CFC=7 (non-Medicare adjudication) automatically.
//
// Phone-first: every input is full-width, numeric keyboards on numeric
// fields, ≥44px tap targets.

'use client'

import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'

export type CorrectionDefaults = {
  principalDiagnosis: string
  placeOfServiceCode: string
  priorAuthorizationNumber: string
}

export function CorrectionsForm({
  defaults,
  rejectionReasons,
  busy,
  onCancel,
  onSubmit,
}: {
  defaults: CorrectionDefaults
  rejectionReasons: string
  busy: boolean
  onCancel: () => void
  onSubmit: (payload: { corrections: Record<string, unknown>; reason: string }) => void
}) {
  const [principalDiagnosis, setPrincipalDiagnosis] = useState(defaults.principalDiagnosis)
  const [placeOfServiceCode, setPlaceOfServiceCode] = useState(defaults.placeOfServiceCode)
  const [priorAuthorizationNumber, setPriorAuthorizationNumber] = useState(
    defaults.priorAuthorizationNumber,
  )
  const [reason, setReason] = useState('')

  const handle = () => {
    // Build a minimal claimInformation override dict — only fields that
    // the user actually changed are sent; the resubmit pipeline
    // (lib/ehr/stedi-resubmit) merges these on top of the rebuilt
    // claim from current invoice state.
    const corrections: Record<string, unknown> = {}
    if (principalDiagnosis.trim() && principalDiagnosis !== defaults.principalDiagnosis) {
      corrections.principalDiagnosis = {
        qualifierCode: 'ABK',
        principalDiagnosisCode: principalDiagnosis.trim().replace(/\./g, ''),
      }
    }
    if (placeOfServiceCode.trim() && placeOfServiceCode !== defaults.placeOfServiceCode) {
      corrections.placeOfServiceCode = placeOfServiceCode.trim()
    }
    if (priorAuthorizationNumber.trim() !== defaults.priorAuthorizationNumber) {
      // Empty string = clear; anything else = set
      corrections.priorAuthorizationNumber = priorAuthorizationNumber.trim() || null
    }
    onSubmit({ corrections, reason: reason.trim() })
  }

  return (
    <div className="space-y-4">
      {rejectionReasons && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3">
          <div className="text-[11px] uppercase tracking-wider text-red-700 font-medium mb-1">
            Payer rejection reasons (277CA)
          </div>
          <pre className="text-xs text-red-900 whitespace-pre-wrap font-sans">{rejectionReasons}</pre>
        </div>
      )}

      <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700">
        Stedi will pick the claim frequency code automatically:
        <br />
        <span className="font-mono">CFC=1</span> for Medicare or pre-adjudication
        (reuses PCN, no PCCN);{' '}
        <span className="font-mono">CFC=7</span> for non-Medicare adjudicated
        claims (new PCN, includes PCCN).
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-700">Principal ICD-10</span>
        <input
          type="text"
          value={principalDiagnosis}
          onChange={(e) => setPrincipalDiagnosis(e.target.value.toUpperCase())}
          placeholder="e.g. F41.1"
          className="w-full h-11 px-3 rounded-md border border-gray-300 text-sm bg-white font-mono"
          autoComplete="off"
        />
        <span className="text-[11px] text-gray-500">
          Pre-filled from the first charge's note. Periods optional.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-700">Place of service code</span>
        <input
          type="text"
          inputMode="numeric"
          value={placeOfServiceCode}
          onChange={(e) => setPlaceOfServiceCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
          placeholder="e.g. 02 (telehealth) or 11 (office)"
          className="w-full h-11 px-3 rounded-md border border-gray-300 text-sm bg-white font-mono"
          autoComplete="off"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-700">Prior authorization #</span>
        <input
          type="text"
          value={priorAuthorizationNumber}
          onChange={(e) => setPriorAuthorizationNumber(e.target.value)}
          placeholder="optional"
          className="w-full h-11 px-3 rounded-md border border-gray-300 text-sm bg-white font-mono"
          autoComplete="off"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-700">Reason for correction</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. patient member ID corrected after eligibility re-check"
          className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm bg-white"
        />
        <span className="text-[11px] text-gray-500">
          Stored on the audit log; not sent to the payer.
        </span>
      </label>

      <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-11 px-4 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handle}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-md bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white text-sm font-medium"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
          Resubmit claim
        </button>
      </div>
    </div>
  )
}

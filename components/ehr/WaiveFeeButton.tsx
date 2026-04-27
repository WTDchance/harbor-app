// components/ehr/WaiveFeeButton.tsx
//
// Wave 42 — Therapist-side override for the cancellation policy. Renders
// a Waive button per fee kind that has been charged on the appointment;
// renders nothing when no fees are charged. Used in the appointment edit
// modal but is intentionally generic — drop into any future appointment
// detail page.
//
// Server contract:
//   GET  /api/ehr/appointments/{id}/waive-fee  -> { cancellation_fee_charged_cents, no_show_fee_charged_cents, ... }
//   POST /api/ehr/appointments/{id}/waive-fee  body { kind, reason? }

'use client'

import { useEffect, useState } from 'react'

interface FeeState {
  cancellation_fee_charged_cents: number | null
  no_show_fee_charged_cents: number | null
  cancellation_fee_stripe_charge_id: string | null
  no_show_fee_stripe_charge_id: string | null
  late_canceled_at: string | null
}

interface Props {
  appointmentId: string
  /** Fired after a successful waiver so the parent can refresh state. */
  onWaived?: (kind: 'late_cancel' | 'no_show') => void
}

export function WaiveFeeButton({ appointmentId, onWaived }: Props) {
  const [state, setState] = useState<FeeState | null>(null)
  const [busyKind, setBusyKind] = useState<'late_cancel' | 'no_show' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      const res = await fetch(`/api/ehr/appointments/${appointmentId}/waive-fee`, { cache: 'no-store' })
      if (!res.ok) return
      const j = (await res.json()) as FeeState
      setState(j)
    } catch (err) {
      console.error('[WaiveFeeButton] refresh failed', err)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId])

  async function waive(kind: 'late_cancel' | 'no_show') {
    setBusyKind(kind)
    setError(null)
    try {
      const reason = window.prompt(
        kind === 'late_cancel'
          ? 'Reason for waiving the late-cancel fee (optional, recorded in audit log):'
          : 'Reason for waiving the no-show fee (optional, recorded in audit log):',
      ) ?? undefined
      const res = await fetch(`/api/ehr/appointments/${appointmentId}/waive-fee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, reason }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || 'waiver_failed')
      }
      await refresh()
      onWaived?.(kind)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyKind(null)
    }
  }

  if (!state) return null
  const cents = (n: number | null) => (n != null ? `$${(n / 100).toFixed(2)}` : '—')
  const showLate = (state.cancellation_fee_charged_cents ?? 0) > 0
  const showNoShow = (state.no_show_fee_charged_cents ?? 0) > 0
  if (!showLate && !showNoShow) return null

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">Cancellation policy fees</p>
      {showLate && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-amber-900">
            Late-cancel fee: {cents(state.cancellation_fee_charged_cents)}
            {state.cancellation_fee_stripe_charge_id && (
              <span className="text-xs text-amber-700 ml-2">(charge {state.cancellation_fee_stripe_charge_id})</span>
            )}
          </span>
          <button
            type="button"
            disabled={busyKind === 'late_cancel'}
            onClick={() => waive('late_cancel')}
            className="text-xs font-medium px-3 py-1 rounded-md bg-white border border-amber-300 hover:bg-amber-100 disabled:opacity-50"
          >
            {busyKind === 'late_cancel' ? 'Waiving…' : 'Waive fee'}
          </button>
        </div>
      )}
      {showNoShow && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-amber-900">
            No-show fee: {cents(state.no_show_fee_charged_cents)}
            {state.no_show_fee_stripe_charge_id && (
              <span className="text-xs text-amber-700 ml-2">(charge {state.no_show_fee_stripe_charge_id})</span>
            )}
          </span>
          <button
            type="button"
            disabled={busyKind === 'no_show'}
            onClick={() => waive('no_show')}
            className="text-xs font-medium px-3 py-1 rounded-md bg-white border border-amber-300 hover:bg-amber-100 disabled:opacity-50"
          >
            {busyKind === 'no_show' ? 'Waiving…' : 'Waive fee'}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

export default WaiveFeeButton

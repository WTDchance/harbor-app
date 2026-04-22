// components/ehr/BillingCard.tsx
// Patient-profile billing summary: balance, last charges, last payments,
// + quick actions (record payment, generate superbill).

'use client'

import { useEffect, useState } from 'react'
import { DollarSign, CreditCard, FileDown, Plus, Send } from 'lucide-react'
import { usePreferences } from '@/lib/ehr/use-preferences'

type Charge = {
  id: string; cpt_code: string; units: number; fee_cents: number; allowed_cents: number
  copay_cents: number; billed_to: string; status: string; service_date: string
}
type Payment = {
  id: string; source: string; amount_cents: number; received_at: string; charge_id: string | null; note: string | null
}
type Summary = {
  balance_cents: number; billed_cents: number; received_cents: number; written_off_cents: number
  charges: Charge[]; payments: Payment[]
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  submitted: 'bg-blue-50 text-blue-800 border-blue-200',
  partial: 'bg-amber-50 text-amber-800 border-amber-200',
  paid: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  denied: 'bg-red-50 text-red-800 border-red-200',
  written_off: 'bg-gray-50 text-gray-500 border-gray-200',
  void: 'bg-gray-50 text-gray-500 border-gray-200',
}

function cents(n: number | null | undefined): string {
  if (n == null) return '$0.00'
  const sign = n < 0 ? '-' : ''
  return `${sign}$${(Math.abs(n) / 100).toFixed(2)}`
}

export function BillingCard({ patientId }: { patientId: string }) {
  const { prefs } = usePreferences()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [superbillOpen, setSuperbillOpen] = useState(false)
  const [invoiceOpen, setInvoiceOpen] = useState(false)

  async function load() {
    try {
      const res = await fetch(`/api/ehr/billing/patient-summary?patient_id=${encodeURIComponent(patientId)}`)
      if (res.status === 403) { setEnabled(false); return }
      const json = await res.json()
      setSummary(json)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-line */ }, [patientId])

  if (!enabled || loading) return null
  if (prefs && prefs.features.billing === false) return null
  if (!summary) return null

  return (
    <div className="bg-white border rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-gray-500" />
          Billing
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setPaymentOpen(true)}
            className="inline-flex items-center gap-1 text-xs bg-white border border-gray-300 text-gray-700 px-2.5 py-1.5 rounded-md hover:bg-gray-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Record payment
          </button>
          <button
            onClick={() => setInvoiceOpen(true)}
            className="inline-flex items-center gap-1 text-xs bg-white border border-teal-600 text-teal-700 px-2.5 py-1.5 rounded-md hover:bg-teal-50"
          >
            <Send className="w-3.5 h-3.5" />
            Send invoice
          </button>
          <button
            onClick={() => setSuperbillOpen(true)}
            className="inline-flex items-center gap-1 text-xs bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-md"
          >
            <FileDown className="w-3.5 h-3.5" />
            Superbill
          </button>
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <Mini label="Balance" value={cents(summary.balance_cents)} accent={summary.balance_cents > 0 ? 'amber' : 'green'} />
        <Mini label="Billed" value={cents(summary.billed_cents)} />
        <Mini label="Received" value={cents(summary.received_cents)} />
        <Mini label="Written off" value={cents(summary.written_off_cents)} />
      </div>

      {/* Recent charges */}
      {summary.charges.length > 0 && (
        <div className="mb-3">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Recent charges</div>
          <ul className="divide-y divide-gray-100">
            {summary.charges.slice(0, 5).map((c) => (
              <li key={c.id} className="py-1.5 flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs font-semibold text-teal-700">{c.cpt_code}</span>
                  <span className="text-gray-600 text-xs">
                    {new Date(c.service_date).toLocaleDateString()} · {c.billed_to.replace('_', ' ')}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_COLORS[c.status] ?? STATUS_COLORS.pending}`}>
                    {c.status}
                  </span>
                </div>
                <span className="font-mono text-xs font-semibold text-gray-900">{cents(c.allowed_cents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recent payments */}
      {summary.payments.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Recent payments</div>
          <ul className="space-y-1">
            {summary.payments.slice(0, 3).map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <CreditCard className="w-3 h-3" />
                  {new Date(p.received_at).toLocaleDateString()} · {p.source.replace(/_/g, ' ')}
                  {p.note && <span className="text-gray-400 italic">— {p.note}</span>}
                </div>
                <span className="font-mono text-xs font-semibold text-emerald-700">{cents(p.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.charges.length === 0 && summary.payments.length === 0 && (
        <p className="text-sm text-gray-500">No billing activity yet. Charges auto-create when you sign notes with CPT codes.</p>
      )}

      {paymentOpen && (
        <RecordPaymentModal patientId={patientId} onClose={() => setPaymentOpen(false)} onSaved={() => { setPaymentOpen(false); load() }} />
      )}
      {superbillOpen && (
        <SuperbillModal patientId={patientId} onClose={() => setSuperbillOpen(false)} />
      )}
      {invoiceOpen && (
        <InvoiceModal
          patientId={patientId}
          charges={summary.charges.filter((c) => (c.billed_to === 'both' || c.billed_to === 'patient_self_pay') && c.status !== 'paid' && c.status !== 'void' && c.status !== 'written_off')}
          onClose={() => setInvoiceOpen(false)}
          onSent={() => { setInvoiceOpen(false); load() }}
        />
      )}
    </div>
  )
}

function InvoiceModal({ patientId, charges, onClose, onSent }: {
  patientId: string
  charges: Charge[]
  onClose: () => void
  onSent: () => void
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(charges.map((c) => [c.id, true])),
  )
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ url: string } | null>(null)
  const ids = Object.keys(selected).filter((k) => selected[k])
  const total = charges
    .filter((c) => selected[c.id])
    .reduce((s, c) => s + (c.billed_to === 'both' ? c.copay_cents : c.allowed_cents), 0)

  async function submit() {
    if (ids.length === 0) return
    setSending(true)
    try {
      const res = await fetch('/api/ehr/billing/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, charge_ids: ids }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      setResult({ url: json.pay_url })
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        {result ? (
          <div className="space-y-3">
            <div className="text-lg font-semibold text-emerald-700">Invoice sent</div>
            <p className="text-sm text-gray-600">Patient received an email with a secure pay link.</p>
            {result.url && (
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Pay link (copy + share)</div>
                <input readOnly value={result.url} onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono bg-gray-50" />
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={onSent} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg">
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-lg font-semibold text-gray-900">Send invoice</div>
            <p className="text-sm text-gray-500">Select the patient-billable charges to include. Stripe emails the patient with a pay link.</p>
            {charges.length === 0 ? (
              <p className="text-sm text-gray-500 italic py-4">No patient-billable charges to invoice right now.</p>
            ) : (
              <ul className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {charges.map((c) => {
                  const amt = c.billed_to === 'both' ? c.copay_cents : c.allowed_cents
                  return (
                    <li key={c.id} className="p-2 flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={!!selected[c.id]}
                        onChange={(e) => setSelected({ ...selected, [c.id]: e.target.checked })} />
                      <div className="flex-1">
                        <div className="font-mono text-xs font-semibold text-teal-700">{c.cpt_code}</div>
                        <div className="text-xs text-gray-500">{new Date(c.service_date).toLocaleDateString()} · {c.billed_to.replace('_', ' ')}</div>
                      </div>
                      <span className="font-mono text-xs font-semibold">{cents(amt)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-gray-600">Total</span>
              <span className="text-lg font-bold font-mono">{cents(total)}</span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={submit} disabled={sending || ids.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                <Send className="w-4 h-4" />
                {sending ? 'Sending…' : 'Send via email'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: 'green' | 'amber' }) {
  const cls = accent === 'amber' ? 'text-amber-700' : accent === 'green' ? 'text-emerald-700' : 'text-gray-900'
  return (
    <div className="bg-gray-50 rounded-lg p-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-sm font-bold font-mono ${cls}`}>{value}</div>
    </div>
  )
}

function RecordPaymentModal({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState('manual_check')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const cents = Math.round(parseFloat(amount) * 100)
    if (!cents || cents <= 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/ehr/billing/payments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, amount_cents: cents, source, note: note || null }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      onSaved()
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Record payment</h3>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Amount (USD)</label>
            <input type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Source</label>
            <select value={source} onChange={(e) => setSource(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="manual_check">Check</option>
              <option value="manual_cash">Cash</option>
              <option value="manual_card_external">Card (entered elsewhere)</option>
              <option value="insurance_era">Insurance (ERA)</option>
              <option value="adjustment">Adjustment / write-off</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Check #1234"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Record payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SuperbillModal({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = today.slice(0, 8) + '01'
  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo] = useState(today)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Generate superbill</h3>
        <p className="text-xs text-gray-500 mb-4">
          Itemized receipt the patient can submit to their insurance for out-of-network reimbursement.
        </p>
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
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
          <a
            href={`/api/ehr/billing/superbill?patient_id=${encodeURIComponent(patientId)}&from=${from}&to=${to}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg"
          >
            <FileDown className="w-4 h-4" />
            Generate
          </a>
        </div>
      </div>
    </div>
  )
}

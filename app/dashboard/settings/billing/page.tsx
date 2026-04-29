// /dashboard/settings/billing — practice billing self-service.
//
// Shows: current plan, next charge date, change-plan UI, cancel/reactivate
// button, link into Stripe Customer Portal, recent invoices.

'use client'

import { useEffect, useState } from 'react'
import {
  PastDueBanner,
  TrialEndingSoonBanner,
  CancellationScheduledBanner,
} from '@/components/billing/SubscriptionBanners'

type Subscription = {
  tier: string
  status: string
  trial_ends_at: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
} | null

type Invoice = {
  id: string
  stripe_invoice_id: string
  stripe_invoice_number: string | null
  amount_due_cents: number
  amount_paid_cents: number
  currency: string
  status: string
  hosted_invoice_url: string | null
  invoice_pdf_url: string | null
  paid_at: string | null
  created_at: string
}

type CatalogEntry = {
  key: string
  name: string
  description: string
  amount_usd_cents: number
}

function formatCents(cents: number, currency = 'usd'): string {
  const dollars = cents / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(dollars)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function BillingSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subscription, setSubscription] = useState<Subscription>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [catalog, setCatalog] = useState<Record<string, CatalogEntry>>({})
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/subscription')
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'load_failed')
      setSubscription(data.subscription)
      setInvoices(data.invoices ?? [])
      setCatalog(data.catalog ?? {})
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function callBillingPost(path: string, body?: Record<string, unknown>) {
    setBusy(path)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'request_failed')
      if (data.url) {
        window.location.href = data.url as string
        return
      }
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-neutral-500">Loading billing…</div>
  }

  const currentTier = subscription?.tier ?? null
  const tierConfig = currentTier ? catalog[currentTier] : null

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold mb-6">Billing</h1>

      {error ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {subscription?.status === 'past_due' ? <PastDueBanner /> : null}
      {subscription?.status === 'trialing' && subscription.trial_ends_at ? (
        <TrialEndingSoonBanner trialEndsAt={subscription.trial_ends_at} />
      ) : null}
      {subscription?.cancel_at_period_end && subscription.current_period_end ? (
        <CancellationScheduledBanner
          periodEnd={subscription.current_period_end}
        />
      ) : null}

      <section className="rounded border border-neutral-200 p-5 mb-6">
        <h2 className="font-semibold mb-3">Current plan</h2>
        {subscription ? (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-neutral-500">Plan</dt>
            <dd>
              {tierConfig?.name ?? subscription.tier}{' '}
              {tierConfig
                ? `(${formatCents(tierConfig.amount_usd_cents)}/mo)`
                : null}
            </dd>
            <dt className="text-neutral-500">Status</dt>
            <dd className="font-medium">{subscription.status}</dd>
            {subscription.trial_ends_at ? (
              <>
                <dt className="text-neutral-500">Trial ends</dt>
                <dd>{formatDate(subscription.trial_ends_at)}</dd>
              </>
            ) : null}
            <dt className="text-neutral-500">Next charge</dt>
            <dd>{formatDate(subscription.current_period_end)}</dd>
          </dl>
        ) : (
          <div className="text-sm text-neutral-600">
            No active subscription.{' '}
            <a className="text-blue-600 underline" href="/onboarding/billing">
              Pick a plan
            </a>
            .
          </div>
        )}
      </section>

      {subscription ? (
        <section className="rounded border border-neutral-200 p-5 mb-6">
          <h2 className="font-semibold mb-3">Change plan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.values(catalog).map((tier) => (
              <button
                key={tier.key}
                disabled={busy !== null || tier.key === currentTier}
                onClick={() =>
                  void callBillingPost('/api/billing/change-plan', {
                    tier: tier.key,
                  })
                }
                className={`text-left rounded border p-3 ${
                  tier.key === currentTier
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-neutral-200 hover:border-blue-400'
                }`}
              >
                <div className="font-medium">{tier.name}</div>
                <div className="text-sm text-neutral-600">
                  {formatCents(tier.amount_usd_cents)}/mo
                </div>
                {tier.key === currentTier ? (
                  <div className="mt-1 text-xs text-blue-700">Current plan</div>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {subscription ? (
        <section className="rounded border border-neutral-200 p-5 mb-6">
          <h2 className="font-semibold mb-3">Manage</h2>
          <div className="flex flex-wrap gap-3">
            <button
              disabled={busy !== null}
              onClick={() => void callBillingPost('/api/billing/portal-session')}
              className="rounded bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50"
            >
              Open Customer Portal
            </button>
            {subscription.cancel_at_period_end ? (
              <button
                disabled={busy !== null}
                onClick={() => void callBillingPost('/api/billing/reactivate')}
                className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                Resume subscription
              </button>
            ) : (
              <button
                disabled={busy !== null}
                onClick={() => void callBillingPost('/api/billing/cancel')}
                className="rounded border border-red-200 text-red-700 px-4 py-2 text-sm hover:bg-red-50 disabled:opacity-50"
              >
                Cancel at period end
              </button>
            )}
          </div>
        </section>
      ) : null}

      <section className="rounded border border-neutral-200 p-5">
        <h2 className="font-semibold mb-3">Invoice history</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-neutral-500">No invoices yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-2">Date</th>
                <th>Number</th>
                <th>Amount</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-neutral-100">
                  <td className="py-2">{formatDate(inv.created_at)}</td>
                  <td>{inv.stripe_invoice_number ?? '—'}</td>
                  <td>
                    {formatCents(inv.amount_paid_cents || inv.amount_due_cents, inv.currency)}
                  </td>
                  <td>{inv.status}</td>
                  <td className="space-x-2">
                    {inv.hosted_invoice_url ? (
                      <a
                        href={inv.hosted_invoice_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline"
                      >
                        View
                      </a>
                    ) : null}
                    {inv.invoice_pdf_url ? (
                      <a
                        href={inv.invoice_pdf_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline"
                      >
                        PDF
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

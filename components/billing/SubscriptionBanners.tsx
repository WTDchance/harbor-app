// components/billing/SubscriptionBanners.tsx
//
// Three small banner components surfaced on /dashboard/settings/billing
// (and on dashboard layout if the practice is past_due / suspended).
// Pure presentational — no data fetch.

'use client'

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

export function PastDueBanner() {
  return (
    <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <strong>Payment failed.</strong> Your last invoice didn&apos;t go
      through. Update your payment method in the Customer Portal to keep your
      account active.
    </div>
  )
}

export function TrialEndingSoonBanner({ trialEndsAt }: { trialEndsAt: string }) {
  const days = daysUntil(trialEndsAt)
  if (days > 7) return null
  return (
    <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
      <strong>Trial ends in {days} day{days === 1 ? '' : 's'}.</strong>{' '}
      You&apos;ll be charged on{' '}
      {new Date(trialEndsAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
      })}
      . You can change plan or cancel any time before then.
    </div>
  )
}

export function CancellationScheduledBanner({ periodEnd }: { periodEnd: string }) {
  return (
    <div className="mb-4 rounded border border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-800">
      <strong>Cancellation scheduled.</strong> Your subscription will end on{' '}
      {new Date(periodEnd).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })}
      . You can resume any time before then.
    </div>
  )
}

export function SuspendedBanner() {
  return (
    <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <strong>Account suspended.</strong> Multiple invoices are unpaid. Most
      Harbor features are paused until your billing is resolved. Visit the
      Customer Portal to update your payment method.
    </div>
  )
}

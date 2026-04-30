'use client'

import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CreditCard, AlertCircle, CheckCircle } from 'lucide-react'

interface PracticeWithBilling {
  id: string
  name: string
  notification_email: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: string
  trial_ends_at: string | null
  billing_email: string | null
}

function BillingPageContent() {
  const [practice, setPractice] = useState<PracticeWithBilling | null>(null)
  const [loading, setLoading] = useState(true)
  const [redirecting, setRedirecting] = useState(false)
  const searchParams = useSearchParams()
  const success = searchParams.get('success')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/practice/me', { cache: 'no-store' })
        if (!res.ok) {
          setLoading(false)
          return
        }
        const body = await res.json()
        if (body.practice) {
          // Map AWS schema to legacy shape consumed by this page
          const p = body.practice
          setPractice({
            id: p.id,
            name: p.name,
            notification_email: body.user?.email ?? '',
            stripe_customer_id: p.stripe_customer_id ?? null,
            stripe_subscription_id: p.stripe_subscription_id ?? null,
            subscription_status: p.subscription_status ?? p.provisioning_state ?? 'unknown',
            trial_ends_at: p.trial_ends_at ?? null,
            billing_email: p.billing_email ?? body.user?.email ?? null,
          })
        }
      } catch (err) {
        console.error('Failed to load practice:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleManageBilling = async () => {
    if (!practice?.notification_email) return
    setRedirecting(true)
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: practice.notification_email }),
      })
      if (res.ok) {
        const { url } = await res.json()
        window.location.href = url
      } else {
        alert('Failed to open billing portal')
        setRedirecting(false)
      }
    } catch (error) {
      console.error('Error opening billing portal:', error)
      alert('Error opening billing portal')
      setRedirecting(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-50 border-green-200 text-green-700'
      case 'trialing': return 'bg-blue-50 border-blue-200 text-blue-700'
      case 'past_due': return 'bg-red-50 border-red-200 text-red-700'
      case 'cancelled': return 'bg-gray-50 border-gray-200 text-gray-700'
      default: return 'bg-gray-50 border-gray-200 text-gray-700'
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return { label: 'Active', icon: CheckCircle, color: 'text-green-600' }
      case 'trialing': return { label: 'Trial', icon: CheckCircle, color: 'text-blue-600' }
      case 'past_due': return { label: 'Payment Failed', icon: AlertCircle, color: 'text-red-600' }
      case 'cancelled': return { label: 'Cancelled', icon: AlertCircle, color: 'text-gray-600' }
      default: return { label: 'Unknown', icon: AlertCircle, color: 'text-gray-600' }
    }
  }

  const formatDate = (isoString: string | null) => {
    if (!isoString) return null
    return new Date(isoString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!practice) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-500">No practice found. Please contact support.</p>
      </div>
    )
  }

  const statusInfo = getStatusBadge(practice.subscription_status)
  const StatusIcon = statusInfo.icon
  const trialEndsAt = practice.trial_ends_at ? formatDate(practice.trial_ends_at) : null
  const daysUntilTrialEnds = practice.trial_ends_at
    ? Math.ceil((new Date(practice.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Billing & Subscription</h1>
        <p className="text-gray-500 mt-1">Manage your Harbor subscription</p>
      </div>

      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-green-900">Subscription activated</p>
            <p className="text-sm text-green-700 mt-0.5">Your billing has been set up. Enjoy Harbor!</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Harbor Pro</h2>
            <p className="text-sm text-gray-500 mt-1">AI Receptionist for therapy practices</p>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${getStatusColor(practice.subscription_status)}`}>
            <StatusIcon className={`w-4 h-4 ${statusInfo.color}`} />
            <span className="text-sm font-medium">{statusInfo.label}</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900">$499</span>
            <span className="text-gray-500">/month</span>
          </div>

          {practice.subscription_status === 'trialing' && trialEndsAt && daysUntilTrialEnds !== null && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900">
                <span className="font-medium">Free trial ends on {trialEndsAt}</span>
                <span className="text-blue-700"> ({daysUntilTrialEnds} days remaining)</span>
              </p>
              <p className="text-xs text-blue-700 mt-1">Your subscription will automatically continue after the trial.</p>
            </div>
          )}

          {practice.subscription_status === 'past_due' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm font-medium text-red-900">Payment failed</p>
              <p className="text-xs text-red-700 mt-1">Your recent payment did not go through. Please update your payment method.</p>
            </div>
          )}

          {practice.subscription_status === 'cancelled' && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-900">Subscription cancelled</p>
              <p className="text-xs text-gray-600 mt-1">Your subscription has been cancelled. Your data will be retained for 30 days.</p>
            </div>
          )}

          <div className="pt-2">
            <p className="text-xs text-gray-500">Billing email</p>
            <p className="text-sm font-medium text-gray-900">{practice.billing_email || practice.notification_email}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Manage Billing</h3>
        <p className="text-sm text-gray-500 mb-4">Update your payment method, billing information, or cancel your subscription.</p>
        <button
          onClick={handleManageBilling}
          disabled={redirecting}
          className="flex items-center gap-2 bg-teal-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          <CreditCard className="w-4 h-4" />
          {redirecting ? 'Redirecting...' : 'Go to Billing Portal'}
        </button>
      </div>

      {practice.subscription_status === 'cancelled' && (
        <div className="mt-6 bg-teal-50 border border-teal-200 rounded-xl p-6">
          <h3 className="font-semibold text-gray-900 mb-2">Reactivate your subscription?</h3>
          <p className="text-sm text-gray-600 mb-4">Start a new 14-day free trial to bring Harbor back online.</p>
          <button
            onClick={handleManageBilling}
            disabled={redirecting}
            className="bg-teal-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {redirecting ? 'Loading...' : 'Resubscribe'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <BillingPageContent />
    </Suspense>
  )
    }

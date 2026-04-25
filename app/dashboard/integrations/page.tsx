'use client'

import { useEffect, useState } from 'react'
import { Plug, Clock, CheckCircle, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

interface Integration {
  id: string
  name: string
  description: string
  status: 'connected' | 'coming_soon' | 'setup_needed'
  icon: string
  action?: string
}

export default function IntegrationsPage() {
  const [practice, setPractice] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const loadPractice = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      const { data: practiceData } = await supabase
        .from('practices')
        .select('*')
        .eq('notification_email', user.email)
        .single()

      if (practiceData) {
        setPractice(practiceData)
      }

      setLoading(false)
    }

    loadPractice()
  }, [supabase])

  const integrations: Integration[] = [
    {
      id: 'stripe',
      name: 'Stripe',
      description: 'Billing and subscription management',
      status: practice?.stripe_customer_id ? 'connected' : 'setup_needed',
      icon: '💳',
      action: 'Manage Billing',
    },
    {
      id: 'simplepractice',
      name: 'SimplePractice',
      description: 'Sync call summaries and patient notes to SimplePractice EHR',
      status: 'coming_soon',
      icon: '📋',
    },
    {
      id: 'jane',
      name: 'Jane App',
      description: 'Two-way sync with Jane scheduling and EHR',
      status: 'coming_soon',
      icon: '📅',
    },
    {
      id: 'valant',
      name: 'Valant',
      description: 'Integrate with Valant behavioral health EHR',
      status: 'coming_soon',
      icon: '🏥',
    },
    {
      id: 'google_calendar',
      name: 'Google Calendar',
      description: 'Check therapist availability and schedule calls',
      status: 'coming_soon',
      icon: '📆',
    },
    {
      id: 'twilio',
      name: 'Twilio',
      description: 'Voice communication and SMS reminders',
      status: 'connected',
      icon: '📞',
    },
  ]

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'connected':
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 rounded-full">
            <CheckCircle className="w-4 h-4 text-green-700" />
            <span className="text-sm font-medium text-green-700">Connected</span>
          </div>
        )
      case 'coming_soon':
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 rounded-full">
            <Clock className="w-4 h-4 text-blue-700" />
            <span className="text-sm font-medium text-blue-700">Coming Soon</span>
          </div>
        )
      case 'setup_needed':
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-100 rounded-full">
            <Clock className="w-4 h-4 text-yellow-700" />
            <span className="text-sm font-medium text-yellow-700">Setup Needed</span>
          </div>
        )
      default:
        return null
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
        <p className="text-gray-500 mt-1">Connect Harbor to your favorite tools</p>
      </div>

      {/* Connected integrations info */}
      <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 mb-8">
        <p className="text-sm text-teal-900">
          Harbor integrates with popular therapy practice tools. More integrations coming soon. <a href="mailto:partnerships@harbor.ai" className="font-medium hover:underline">Let us know what you need</a>.
        </p>
      </div>

      {/* Integration cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {integrations.map(integration => (
          <div key={integration.id} className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="text-3xl">{integration.icon}</div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{integration.name}</h3>
                  <p className="text-sm text-gray-500 mt-0.5">{integration.description}</p>
                </div>
              </div>
            </div>

            {/* Status badge and action */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
              <div>{getStatusBadge(integration.status)}</div>
              {integration.status === 'setup_needed' && integration.action && (
                <a
                  href="/dashboard/billing"
                  className="flex items-center gap-1 text-teal-600 hover:text-teal-700 font-medium text-sm"
                >
                  {integration.action} <ArrowRight className="w-4 h-4" />
                </a>
              )}
              {integration.status === 'connected' && integration.action && (
                <a
                  href="/dashboard/billing"
                  className="flex items-center gap-1 text-teal-600 hover:text-teal-700 font-medium text-sm"
                >
                  {integration.action} <ArrowRight className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Request integration section */}
      <div className="mt-12 bg-gradient-to-r from-teal-50 to-blue-50 rounded-xl border border-teal-200 p-8 text-center">
        <Plug className="w-12 h-12 text-teal-600 mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Missing an integration?</h3>
        <p className="text-gray-600 mb-6">We're building connectors to your favorite EHRs and practice management systems. Let us know what would help your workflow.</p>
        <a
          href="mailto:partnerships@harbor.ai"
          className="inline-flex items-center gap-2 bg-teal-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-teal-700 transition-colors"
        >
          Request an Integration
          <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    </div>
  )
}

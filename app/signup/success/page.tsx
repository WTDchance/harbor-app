'use client'

// /signup/success — landing page after Stripe Checkout redirects back.
// Polls /api/signup/status until the webhook has finished provisioning
// Twilio + Vapi, then shows the new practice's Harbor phone number and a
// button to jump to the dashboard.

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Check, Loader2, Phone, ArrowRight } from 'lucide-react'
import posthog from 'posthog-js'

interface StatusResponse {
  status?: string
  provisioning?: boolean
  ready?: boolean
  practice_name?: string
  ai_name?: string
  phone_number?: string
  founding_member?: boolean
  error?: string
}

function formatPhoneForDisplay(e164?: string): string {
  if (!e164) return ''
  const m = e164.replace(/\D/g, '').match(/^1?(\d{3})(\d{3})(\d{4})$/)
  if (!m) return e164
  return `(${m[1]}) ${m[2]}-${m[3]}`
}

function SignupSuccessContent() {
  const router = useRouter()
  const params = useSearchParams()
  const sessionId = params.get('session_id')
  const [data, setData] = useState<StatusResponse | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sessionId) {
      setError('Missing checkout session id.')
      return
    }
    let cancelled = false
    let intervalId: any = null
    let tickId: any = null

    const poll = async () => {
      try {
        const res = await fetch(`/api/signup/status?session_id=${sessionId}`)
        if (!res.ok) return
        const body: StatusResponse = await res.json()
        if (cancelled) return
        setData(body)
        if (body.ready) {
          if (intervalId) clearInterval(intervalId)
          if (tickId) clearInterval(tickId)
        }
      } catch {
        // swallow transient network errors — next poll will retry
      }
    }
    poll()
    intervalId = setInterval(poll, 2500)
    tickId = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
      if (tickId) clearInterval(tickId)
    }
  }, [sessionId])

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md text-center text-white">
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-slate-400">{error}</p>
          <button
            onClick={() => router.push('/signup')}
            className="mt-6 bg-teal-500 hover:bg-teal-600 text-white font-bold py-3 px-6 rounded-lg"
          >
            Back to Signup
          </button>
        </div>
      </div>
    )
  }

  const ready = !!data?.ready

  // Track signup completion in PostHog
  useEffect(() => {
    if (ready && data) {
      posthog.capture('signup_completed', {
        practice_name: data.practice_name,
        ai_name: data.ai_name,
        founding_member: data.founding_member,
        phone_number: data.phone_number,
      })
    }
  }, [ready, data])

  const prettyPhone = formatPhoneForDisplay(data?.phone_number)

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-10 text-center">
          {!ready ? (
            <>
              <div className="w-20 h-20 bg-teal-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Loader2 className="w-10 h-10 text-teal-400 animate-spin" />
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">
                Setting up {data?.ai_name || 'your AI receptionist'}…
              </h1>
              <p className="text-slate-400 mb-6 text-sm">
                We're buying your Harbor phone number, briefing {data?.ai_name || 'Ellie'}, and wiring everything up. This usually takes 15–30 seconds.
              </p>
              <div className="space-y-2 text-left max-w-xs mx-auto text-sm">
                <div className="flex items-center gap-2 text-teal-400">
                  <Check className="w-4 h-4" /> Payment confirmed
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> Purchasing phone number
                </div>
                <div className="flex items-center gap-2 text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> Briefing your AI receptionist
                </div>
                <div className="flex items-center gap-2 text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> Sending welcome email
                </div>
              </div>
              <p className="text-slate-600 text-xs mt-6">Elapsed: {elapsed}s</p>
            </>
          ) : (
            <>
              <div className="w-20 h-20 bg-teal-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <Check className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-3xl font-bold text-white mb-2">You're live! 🎉</h1>
              <p className="text-slate-400 mb-6 text-sm">
                {data?.ai_name || 'Ellie'} is ready to answer calls for{' '}
                <strong className="text-white">{data?.practice_name}</strong>.
              </p>
              {data?.founding_member && (
                <div className="inline-block bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold uppercase tracking-wide px-3 py-1 rounded-full mb-6">
                  Founding Practice — $397/mo locked in forever
                </div>
              )}
              <div className="bg-teal-500/10 border-2 border-teal-500 rounded-xl p-6 mb-6">
                <div className="text-xs uppercase tracking-wider text-teal-300 font-semibold mb-1">
                  Your Harbor phone number
                </div>
                <div className="text-3xl font-bold text-white mb-2 flex items-center justify-center gap-3">
                  <Phone className="w-6 h-6 text-teal-400" />
                  {prettyPhone}
                </div>
                <p className="text-xs text-slate-400">
                  Call it from your phone right now to hear {data?.ai_name || 'Ellie'} in action.
                </p>
              </div>
              <button
                onClick={() => router.push('/dashboard?welcome=1')}
                className="w-full bg-teal-500 hover:bg-teal-600 text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2"
              >
                Open My Dashboard
                <ArrowRight className="w-5 h-5" />
              </button>
              <p className="text-slate-500 text-xs mt-4">
                A welcome email with setup instructions is on its way.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SignupSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
          <Loader2 className="w-10 h-10 text-teal-400 animate-spin" />
        </div>
      }
    >
      <SignupSuccessContent />
    </Suspense>
  )
}

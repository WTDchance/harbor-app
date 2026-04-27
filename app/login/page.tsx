'use client'

// app/login/page.tsx
//
// Wave 32 — Custom Harbor login page. Replaces the Cognito Hosted UI
// (the "DOS-based" default) with a clean Tailwind form that calls
// Cognito InitiateAuth (USER_PASSWORD_AUTH) directly via /api/auth/sign-in.
//
// Brand: teal-600 primary, gray-50 canvas, circular Harbor mark, generous
// whitespace, rounded-2xl card. Mobile-first.

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams?.get('next') || ''
  const initialError = searchParams?.get('error') || ''

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  // Wave 38 TS3 — TOTP MFA challenge
  const [mfaSession, setMfaSession] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, next }),
      })
      const data = await res.json().catch(() => ({}))
      if (data?.challenge === 'SOFTWARE_TOKEN_MFA' && data?.session) {
        // Show MFA step
        setMfaSession(data.session)
        setSubmitting(false)
        return
      }
      if (data?.challenge === 'MFA_SETUP') {
        // Need to enroll. Send them to the setup page after the cookies
        // get set on the next sign-in.
        setError('MFA setup required. Sign in again, then visit /settings/security/mfa-setup.')
        setSubmitting(false)
        return
      }
      if (!res.ok) {
        setError(data?.error || 'Sign in failed. Check your email and password.')
        setSubmitting(false)
        return
      }
      // Success — server set cookies + told us where to go
      const dest = data?.redirect || '/dashboard'
      router.push(dest)
      router.refresh()
    } catch (err) {
      setError('Network error. Please try again.')
      setSubmitting(false)
    }
  }

  async function onSubmitMfa(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const r = await fetch('/api/auth/mfa-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: mfaSession, email, code: mfaCode, next }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(prettyError(data?.error || 'MFA verification failed.'))
        setSubmitting(false)
        return
      }
      const dest = data?.redirect || '/dashboard'
      router.push(dest)
      router.refresh()
    } catch (err) {
      setError('Network error. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo + brand */}
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/harbor-icon-clean.png" alt="Harbor" className="w-14 h-14 mb-4" />
          <h1 className="text-2xl font-semibold text-gray-900">Welcome to Harbor</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to your practice</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
              {prettyError(error)}
            </div>
          )}

          {mfaSession ? (
            <form onSubmit={onSubmitMfa} className="space-y-4">
              <div>
                <label htmlFor="mfa" className="block text-sm font-medium text-gray-700 mb-1">
                  6-digit code from your authenticator app
                </label>
                <input
                  id="mfa"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent tracking-widest text-center font-mono"
                  placeholder="123456"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || mfaCode.length !== 6}
                className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-medium rounded-lg transition disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-h-[44px]"
              >
                {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>) : 'Verify'}
              </button>
              <button
                type="button"
                onClick={() => { setMfaSession(null); setMfaCode(''); setError(null); }}
                className="w-full text-xs text-gray-500 hover:text-gray-700"
              >
                Cancel and start over
              </button>
            </form>
          ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                placeholder="Email address"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <a href="/login/forgot-password" className="text-xs text-teal-700 hover:text-teal-900">
                  Forgot password?
                </a>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                placeholder="Password"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !email || !password}
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-medium rounded-lg transition disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
          )}

          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-500">
              Don't have an account?{' '}
              <a href="/signup" className="text-teal-700 hover:text-teal-900 font-medium">
                Get started
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-gray-400">
          Powered by Harbor · HIPAA-aligned
        </div>
      </div>
    </div>
  )
}

function prettyError(raw: string): string {
  const map: Record<string, string> = {
    NotAuthorizedException: 'Incorrect email or password.',
    UserNotConfirmedException: 'Your account hasn\'t been verified yet — check your email.',
    PasswordResetRequiredException: 'You need to reset your password before signing in.',
    UserNotFoundException: 'We don\'t have an account for that email.',
    TooManyRequestsException: 'Too many attempts. Wait a minute and try again.',
    missing_code: 'Sign in didn\'t complete. Please try again.',
    callback_failed: 'Sign in didn\'t complete. Please try again.',
  }
  return map[raw] || raw
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

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

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo + brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-teal-600 flex items-center justify-center mb-4 shadow-md">
            {/* Anchor / harbor mark — placeholder. Swap for /harbor-icon-clean.png once asset lands. */}
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="6" r="2.5" />
              <path d="M12 8.5v13" />
              <path d="M5 13v2a7 7 0 0 0 14 0v-2" />
              <path d="M3 13h4" />
              <path d="M17 13h4" />
            </svg>
          </div>
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
                placeholder="you@yourpractice.com"
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
                placeholder="••••••••"
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
